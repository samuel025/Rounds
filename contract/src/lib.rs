//! Rounds: escrow, holdings and payouts, acting only on plans the board approved by hash.
//! Plans are canonical-JSON strings; plan_hash = hex(sha256(plan bytes)). See RULES.md R9.
use near_sdk::json_types::U128;
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::store::{IterableMap, IterableSet};
use near_sdk::{env, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseError};

const GAS_FT: Gas = Gas::from_tgas(10);
const GAS_CB: Gas = Gas::from_tgas(15);
const GAS_CLOSE_MIN: Gas = Gas::from_tgas(60);
pub const MAX_DISTRIBUTE: u64 = 8; // 8 payouts x 25 Tgas + overhead < 300 Tgas (open question 6)
const YOCTO: NearToken = NearToken::from_yoctonear(1);

#[near(serializers = [json, borsh])]
#[derive(Clone, PartialEq, Debug)]
pub enum RoundKind { Founder, Safe, Priced }
#[near(serializers = [json, borsh])]
#[derive(Clone, PartialEq, Debug)]
pub enum RoundStatus { Funding, Approved, Closing, Closed, Cancelled }
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct ClassDef { pub id: String, pub authorized: U128 }

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Round {
    pub id: u64, pub kind: RoundKind, pub status: RoundStatus,
    pub plan_hash: String, pub plan_uri: String, pub plan: String,
    pub raise: Vec<(AccountId, U128)>, pub deposits: Vec<(AccountId, U128)>,
    pub deadline_ns: u64,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct Issuance { holder: String, class: String, shares: U128 }
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct SafeRec { pub id: String, pub holder: AccountId, pub amount: U128, pub post_money_cap: U128, pub discount_bps: u32, pub converted: bool }
#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct RoundPlan {
    #[serde(default)] issuances: Vec<Issuance>,
    #[serde(default)] safes: Vec<SafeRec>,
    #[serde(default)] converted_safes: Vec<String>,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Grant {
    pub id: u64, pub grantee: AccountId, pub shares: U128, pub exercised: U128, pub strike_micro: U128,
    pub start_ns: u64, pub term_months: u32, pub cliff_months: u32, pub terminated_at_ns: Option<u64>,
}
#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct GrantPlan { grantee: AccountId, shares: U128, strike_micro: U128, start_ns: u64, term_months: u32, cliff_months: u32 }

#[near(serializers = [json, borsh])]
#[derive(Clone, PartialEq, Debug)]
pub enum PayState { Pending, Sending, Paid }
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Payout { pub holder: AccountId, pub amount: U128, pub state: PayState }
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Exit { pub id: u64, pub plan_hash: String, pub plan_uri: String, pub approved: bool, pub total: U128, pub funded: U128, pub payouts: Vec<Payout> }
#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct ExitPlan { payouts: Vec<(AccountId, U128)> }

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct Msg { action: String, id: u64, shares: Option<U128> }

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Rounds {
    board: AccountId, payment_token: AccountId, month_ns: u64, exercise_window_ns: u64,
    classes: IterableMap<String, ClassDef>, issued: IterableMap<String, u128>,
    holdings: IterableMap<String, u128>, officers: IterableSet<AccountId>,
    rounds: IterableMap<u64, Round>, safes: IterableMap<String, SafeRec>,
    grants: IterableMap<u64, Grant>, exits: IterableMap<u64, Exit>,
    next_round: u64, next_grant: u64, next_exit: u64,
    escrow_total: u128, exit_funds_total: u128,
}

fn event(name: &str, data: &str) {
    env::log_str(&format!("EVENT_JSON:{{\"standard\":\"rounds\",\"version\":\"1.0.0\",\"event\":\"{}\",\"data\":{}}}", name, data));
}
fn hex(b: &[u8]) -> String { b.iter().map(|x| format!("{:02x}", x)).collect() }
fn check_hash(plan: &str, plan_hash: &str) { require!(hex(&env::sha256(plan.as_bytes())) == plan_hash, "plan hash mismatch"); }
fn key(holder: &str, class: &str) -> String { format!("{}|{}", holder, class) }

#[near]
impl Rounds {
    #[init]
    pub fn new(board: AccountId, payment_token: AccountId, classes: Vec<ClassDef>, month_ns: u64, exercise_window_ns: u64) -> Self {
        let mut c = IterableMap::new(b"c");
        for d in classes { c.insert(d.id.clone(), d); }
        Self {
            board, payment_token, month_ns, exercise_window_ns, classes: c, issued: IterableMap::new(b"i"),
            holdings: IterableMap::new(b"h"), officers: IterableSet::new(b"o"), rounds: IterableMap::new(b"r"),
            safes: IterableMap::new(b"s"), grants: IterableMap::new(b"g"), exits: IterableMap::new(b"x"),
            next_round: 1, next_grant: 1, next_exit: 1, escrow_total: 0, exit_funds_total: 0,
        }
    }
    fn only_board(&self) { require!(env::predecessor_account_id() == self.board, "only the board"); }
    fn only_officer(&self) { require!(self.officers.contains(&env::predecessor_account_id()), "only an officer"); }

    pub fn set_officer(&mut self, account: AccountId, enabled: bool) {
        self.only_board();
        if enabled { self.officers.insert(account); } else { self.officers.remove(&account); }
    }
    pub fn add_class(&mut self, class: ClassDef) { self.only_board(); self.classes.insert(class.id.clone(), class); }

    // ---------- rounds ----------
    pub fn propose_round(&mut self, kind: RoundKind, plan_hash: String, plan_uri: String, plan: String, raise: Vec<(AccountId, U128)>, deadline_ns: u64) -> u64 {
        self.only_officer();
        check_hash(&plan, &plan_hash);
        let parsed: RoundPlan = near_sdk::serde_json::from_str(&plan).unwrap_or_else(|_| env::panic_str("bad plan"));
        require!(raise.len() <= 32 && parsed.issuances.len() <= 64 && parsed.safes.len() <= 32, "plan too large");
        if kind == RoundKind::Founder { require!(raise.is_empty(), "founder rounds take no deposits"); }
        else { require!(!raise.is_empty(), "round needs investors"); }
        if kind == RoundKind::Safe { require!(!parsed.safes.is_empty(), "safe round needs safes"); }
        let id = self.next_round; self.next_round += 1;
        let deposits = raise.iter().map(|(a, _)| (a.clone(), U128(0))).collect();
        self.rounds.insert(id, Round { id, kind, status: RoundStatus::Funding, plan_hash: plan_hash.clone(), plan_uri, plan, raise, deposits, deadline_ns });
        event("round_proposed", &format!("{{\"round_id\":{},\"plan_hash\":\"{}\"}}", id, plan_hash));
        id
    }

    /// NEP-141 receiver. Anything not understood is returned in full.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> U128 {
        if env::predecessor_account_id() != self.payment_token { return amount; }
        let m: Msg = match near_sdk::serde_json::from_str(&msg) { Ok(m) => m, Err(_) => return amount };
        let accepted = match m.action.as_str() {
            "round" => self.deposit_round(&sender_id, amount.0, m.id),
            "exit" => self.fund_exit(m.id, amount.0),
            "exercise" => self.exercise(&sender_id, amount.0, m.id, m.shares.map(|s| s.0).unwrap_or(0)),
            _ => 0,
        };
        U128(amount.0 - accepted)
    }
    fn deposit_round(&mut self, sender: &AccountId, amount: u128, round_id: u64) -> u128 {
        let Some(mut r) = self.rounds.get(&round_id).cloned() else { return 0 };
        if r.status != RoundStatus::Funding && r.status != RoundStatus::Approved { return 0 }
        if env::block_timestamp() > r.deadline_ns { return 0 }
        let Some(want) = r.raise.iter().find(|(a, _)| a == sender).map(|(_, v)| v.0) else { return 0 };
        let Some(slot) = r.deposits.iter_mut().find(|(a, _)| a == sender) else { return 0 };
        let take = amount.min(want - slot.1 .0);
        if take == 0 { return 0 }
        slot.1 = U128(slot.1 .0 + take);
        self.escrow_total += take;
        self.rounds.insert(round_id, r);
        event("deposit_recorded", &format!("{{\"round_id\":{},\"investor\":\"{}\",\"amount\":\"{}\"}}", round_id, sender, take));
        take
    }
    pub fn approve_round(&mut self, round_id: u64, plan_hash: String) {
        self.only_board();
        let mut r = self.rounds.get(&round_id).cloned().unwrap_or_else(|| env::panic_str("no such round"));
        require!(r.status == RoundStatus::Funding, "round not awaiting approval");
        require!(r.plan_hash == plan_hash, "plan hash mismatch");
        r.status = RoundStatus::Approved;
        self.rounds.insert(round_id, r);
        event("round_approved", &format!("{{\"round_id\":{},\"plan_hash\":\"{}\"}}", round_id, plan_hash));
    }
    pub fn close_round(&mut self, round_id: u64) -> Option<Promise> {
        require!(env::prepaid_gas() >= GAS_CLOSE_MIN, "attach at least 60 Tgas");
        let mut r = self.rounds.get(&round_id).cloned().unwrap_or_else(|| env::panic_str("no such round"));
        require!(r.status == RoundStatus::Approved, "round not approved or already closing/closed");
        require!(r.raise.iter().zip(r.deposits.iter()).all(|(a, b)| a.1 .0 == b.1 .0), "round not fully funded");
        let total: u128 = r.deposits.iter().map(|d| d.1 .0).sum();
        if total == 0 {
            self.credit_round(&r);
            r.status = RoundStatus::Closed; self.rounds.insert(round_id, r);
            event("round_closed", &format!("{{\"round_id\":{}}}", round_id));
            return None;
        }
        r.status = RoundStatus::Closing; // blocks a second close while the transfer is in flight
        self.rounds.insert(round_id, r);
        Some(Promise::new(self.payment_token.clone())
            .function_call("ft_transfer", format!("{{\"receiver_id\":\"{}\",\"amount\":\"{}\"}}", self.board, total).into_bytes(), YOCTO, GAS_FT)
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_CB).on_close(round_id, U128(total))))
    }
    #[private]
    pub fn on_close(&mut self, round_id: u64, total: U128, #[callback_result] res: Result<(), PromiseError>) -> bool {
        let mut r = self.rounds.get(&round_id).cloned().unwrap_or_else(|| env::panic_str("no such round"));
        if r.status != RoundStatus::Closing { return false }
        if res.is_err() { r.status = RoundStatus::Approved; self.rounds.insert(round_id, r); return false } // retryable
        self.credit_round(&r);
        self.escrow_total -= total.0;
        r.status = RoundStatus::Closed; self.rounds.insert(round_id, r);
        event("round_closed", &format!("{{\"round_id\":{}}}", round_id));
        true
    }
    fn credit_round(&mut self, r: &Round) {
        let p: RoundPlan = near_sdk::serde_json::from_str(&r.plan).unwrap_or_else(|_| env::panic_str("bad plan"));
        for i in &p.issuances { self.credit(&i.holder, &i.class, i.shares.0); }
        for s in p.safes { require!(self.safes.get(&s.id).is_none(), "safe id exists"); self.safes.insert(s.id.clone(), SafeRec { converted: false, ..s }); }
        for id in &p.converted_safes {
            let mut s = self.safes.get(id).cloned().unwrap_or_else(|| env::panic_str("unknown safe"));
            require!(!s.converted, "safe already converted"); s.converted = true; self.safes.insert(id.clone(), s);
        }
    }
    fn credit(&mut self, holder: &str, class: &str, shares: u128) {
        let def = self.classes.get(class).unwrap_or_else(|| env::panic_str("unknown class"));
        let issued = self.issued.get(class).copied().unwrap_or(0) + shares;
        require!(issued <= def.authorized.0, "exceeds authorized shares"); // invariant 1
        self.issued.insert(class.to_string(), issued);
        let k = key(holder, class);
        let cur = self.holdings.get(&k).copied().unwrap_or(0);
        self.holdings.insert(k, cur + shares);
    }
    pub fn cancel_round(&mut self, round_id: u64) {
        let mut r = self.rounds.get(&round_id).cloned().unwrap_or_else(|| env::panic_str("no such round"));
        require!(env::predecessor_account_id() == self.board || env::block_timestamp() > r.deadline_ns, "only the board before the deadline");
        require!(r.status == RoundStatus::Funding || r.status == RoundStatus::Approved, "round cannot be cancelled");
        r.status = RoundStatus::Cancelled;
        let who: Vec<AccountId> = r.deposits.iter().filter(|d| d.1 .0 > 0).map(|d| d.0.clone()).collect();
        self.rounds.insert(round_id, r);
        event("round_cancelled", &format!("{{\"round_id\":{}}}", round_id));
        for a in who { self.refund(round_id, a); }
    }
    pub fn retry_refund(&mut self, round_id: u64, investor: AccountId) { self.refund(round_id, investor); }
    fn refund(&mut self, round_id: u64, investor: AccountId) {
        let mut r = self.rounds.get(&round_id).cloned().unwrap_or_else(|| env::panic_str("no such round"));
        require!(r.status == RoundStatus::Cancelled, "round not cancelled");
        let slot = r.deposits.iter_mut().find(|d| d.0 == investor).unwrap_or_else(|| env::panic_str("no deposit"));
        let amt = slot.1 .0; require!(amt > 0, "nothing to refund");
        slot.1 = U128(0); // locked before the transfer; restored if it fails
        self.rounds.insert(round_id, r);
        let _ = Promise::new(self.payment_token.clone())
            .function_call("ft_transfer", format!("{{\"receiver_id\":\"{}\",\"amount\":\"{}\"}}", investor, amt).into_bytes(), YOCTO, GAS_FT)
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_CB).on_refund(round_id, investor, U128(amt)));
    }
    #[private]
    pub fn on_refund(&mut self, round_id: u64, investor: AccountId, amount: U128, #[callback_result] res: Result<(), PromiseError>) {
        let mut r = self.rounds.get(&round_id).cloned().unwrap_or_else(|| env::panic_str("no such round"));
        if res.is_err() {
            if let Some(s) = r.deposits.iter_mut().find(|d| d.0 == investor) { s.1 = U128(s.1 .0 + amount.0); }
            self.rounds.insert(round_id, r); return;
        }
        self.escrow_total -= amount.0;
        event("refund_sent", &format!("{{\"round_id\":{},\"investor\":\"{}\",\"amount\":\"{}\"}}", round_id, investor, amount.0));
    }

    // ---------- grants ----------
    pub fn grant(&mut self, plan_hash: String, plan: String) -> u64 {
        self.only_board(); check_hash(&plan, &plan_hash);
        let g: GrantPlan = near_sdk::serde_json::from_str(&plan).unwrap_or_else(|_| env::panic_str("bad grant"));
        require!(g.cliff_months <= g.term_months && g.term_months > 0, "bad vesting terms");
        let id = self.next_grant; self.next_grant += 1;
        self.grants.insert(id, Grant { id, grantee: g.grantee.clone(), shares: g.shares, exercised: U128(0), strike_micro: g.strike_micro, start_ns: g.start_ns, term_months: g.term_months, cliff_months: g.cliff_months, terminated_at_ns: None });
        event("grant_created", &format!("{{\"grant_id\":{},\"grantee\":\"{}\",\"shares\":\"{}\"}}", id, g.grantee, g.shares.0));
        id
    }
    pub fn terminate(&mut self, grant_id: u64) {
        self.only_board();
        let mut g = self.grants.get(&grant_id).cloned().unwrap_or_else(|| env::panic_str("no such grant"));
        require!(g.terminated_at_ns.is_none(), "already terminated");
        g.terminated_at_ns = Some(env::block_timestamp()); // vesting freezes; unvested lapse
        self.grants.insert(grant_id, g);
        event("grant_terminated", &format!("{{\"grant_id\":{}}}", grant_id));
    }
    fn vested_of(&self, g: &Grant) -> u128 {
        let end = g.terminated_at_ns.unwrap_or(u64::MAX).min(env::block_timestamp());
        if end < g.start_ns { return 0 }
        let m = (end - g.start_ns) / self.month_ns;
        if m < g.cliff_months as u64 { 0 } else if m >= g.term_months as u64 { g.shares.0 } else { g.shares.0 * m as u128 / g.term_months as u128 }
    }
    pub fn vested(&self, grant_id: u64) -> U128 { U128(self.vested_of(self.grants.get(&grant_id).unwrap_or_else(|| env::panic_str("no such grant")))) }
    fn exercise(&mut self, sender: &AccountId, amount: u128, grant_id: u64, shares: u128) -> u128 {
        let Some(mut g) = self.grants.get(&grant_id).cloned() else { return 0 };
        if &g.grantee != sender || shares == 0 { return 0 }
        if let Some(t) = g.terminated_at_ns { if env::block_timestamp() > t + self.exercise_window_ns { return 0 } }
        let cost = g.strike_micro.0 * shares;
        if amount < cost || shares > self.vested_of(&g) - g.exercised.0 { return 0 }
        g.exercised = U128(g.exercised.0 + shares);
        self.grants.insert(grant_id, g);
        self.credit(&sender.to_string(), "Common", shares);
        // Strike goes to the board treasury asynchronously; ledger tracked as escrow until paid out is out of scope for the demo.
        self.escrow_total += cost;
        event("grant_exercised", &format!("{{\"grant_id\":{},\"shares\":\"{}\",\"paid\":\"{}\"}}", grant_id, shares, cost));
        cost
    }

    // ---------- exits ----------
    pub fn propose_exit(&mut self, plan_hash: String, plan_uri: String, plan: String) -> u64 {
        self.only_officer(); check_hash(&plan, &plan_hash);
        let p: ExitPlan = near_sdk::serde_json::from_str(&plan).unwrap_or_else(|_| env::panic_str("bad exit plan"));
        require!(!p.payouts.is_empty() && p.payouts.len() <= 64, "1 to 64 payouts");
        let total: u128 = p.payouts.iter().map(|x| x.1 .0).sum();
        let id = self.next_exit; self.next_exit += 1;
        self.exits.insert(id, Exit { id, plan_hash: plan_hash.clone(), plan_uri, approved: false, total: U128(total), funded: U128(0),
            payouts: p.payouts.into_iter().map(|(holder, amount)| Payout { holder, amount, state: PayState::Pending }).collect() });
        event("exit_proposed", &format!("{{\"exit_id\":{},\"plan_hash\":\"{}\",\"total\":\"{}\"}}", id, plan_hash, total));
        id
    }
    fn fund_exit(&mut self, exit_id: u64, amount: u128) -> u128 {
        let Some(mut e) = self.exits.get(&exit_id).cloned() else { return 0 };
        let take = amount.min(e.total.0 - e.funded.0);
        if take == 0 { return 0 }
        e.funded = U128(e.funded.0 + take); self.exits.insert(exit_id, e);
        self.exit_funds_total += take; take
    }
    pub fn approve_exit(&mut self, exit_id: u64, plan_hash: String) {
        self.only_board();
        let mut e = self.exits.get(&exit_id).cloned().unwrap_or_else(|| env::panic_str("no such exit"));
        require!(!e.approved, "already approved"); require!(e.plan_hash == plan_hash, "plan hash mismatch");
        e.approved = true; self.exits.insert(exit_id, e);
        event("exit_approved", &format!("{{\"exit_id\":{}}}", exit_id));
    }
    pub fn distribute(&mut self, exit_id: u64, from: u64, limit: u64) {
        require!(limit >= 1 && limit <= MAX_DISTRIBUTE, "limit must be 1..=8");
        require!(env::prepaid_gas() >= Gas::from_tgas(20 + 30 * limit), "not enough gas for this limit");
        let mut e = self.exits.get(&exit_id).cloned().unwrap_or_else(|| env::panic_str("no such exit"));
        require!(e.approved && e.funded.0 == e.total.0, "exit not approved and fully funded");
        let end = (from + limit).min(e.payouts.len() as u64);
        for i in from..end {
            let p = &mut e.payouts[i as usize];
            if p.state != PayState::Pending { continue } // each payout at most once
            p.state = PayState::Sending;
            let (holder, amt) = (p.holder.clone(), p.amount.0);
            let _ = Promise::new(self.payment_token.clone())
                .function_call("ft_transfer", format!("{{\"receiver_id\":\"{}\",\"amount\":\"{}\"}}", holder, amt).into_bytes(), YOCTO, GAS_FT)
                .then(Self::ext(env::current_account_id()).with_static_gas(GAS_CB).on_payout(exit_id, i));
        }
        self.exits.insert(exit_id, e);
    }
    #[private]
    pub fn on_payout(&mut self, exit_id: u64, index: u64, #[callback_result] res: Result<(), PromiseError>) {
        let mut e = self.exits.get(&exit_id).cloned().unwrap_or_else(|| env::panic_str("no such exit"));
        let p = &mut e.payouts[index as usize];
        if p.state != PayState::Sending { return }
        if res.is_err() { p.state = PayState::Pending; self.exits.insert(exit_id, e); return } // retryable
        p.state = PayState::Paid;
        let (h, a) = (p.holder.clone(), p.amount.0);
        self.exit_funds_total -= a;
        self.exits.insert(exit_id, e);
        event("payout_sent", &format!("{{\"exit_id\":{},\"holder\":\"{}\",\"amount\":\"{}\"}}", exit_id, h, a));
    }

    // ---------- views ----------
    pub fn cap_table(&self, from: u64, limit: u64) -> Vec<(String, String, U128)> {
        self.holdings.iter().skip(from as usize).take(limit.min(100) as usize).map(|(k, v)| {
            let (h, c) = k.split_once('|').unwrap(); (h.to_string(), c.to_string(), U128(*v))
        }).collect()
    }
    pub fn holdings_of(&self, holder: String) -> Vec<(String, U128)> {
        self.classes.keys().filter_map(|c| self.holdings.get(&key(&holder, c)).map(|v| (c.clone(), U128(*v)))).collect()
    }
    pub fn round(&self, round_id: u64) -> Option<Round> { self.rounds.get(&round_id).cloned() }
    pub fn grant_of(&self, grant_id: u64) -> Option<Grant> { self.grants.get(&grant_id).cloned() }
    pub fn exit(&self, exit_id: u64) -> Option<Exit> { self.exits.get(&exit_id).cloned() }
    pub fn safe(&self, id: String) -> Option<SafeRec> { self.safes.get(&id).cloned() }
    pub fn issued_of(&self, class: String) -> U128 { U128(self.issued.get(&class).copied().unwrap_or(0)) }
    /// Tokens the contract must still hold: unpaid deposits, funded-unpaid exits, unforwarded strikes.
    pub fn ledger_total(&self) -> U128 { U128(self.escrow_total + self.exit_funds_total) }
    pub fn config(&self) -> (AccountId, AccountId, Vec<ClassDef>) { (self.board.clone(), self.payment_token.clone(), self.classes.values().cloned().collect()) }
}
