use near_workspaces::{network::Sandbox, types::{Gas, NearToken}, Account, Contract, Worker};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const ROUNDS_WASM: &str = "../target/near/rounds.wasm";
const FT_WASM: &str = "../mock-ft/target/near/mock_ft.wasm";
const ONE: NearToken = NearToken::from_yoctonear(1);
const USD: u128 = 1_000_000; // micro-dollars per dollar = token units

/// The plan as it goes on chain: the round's body plus its money terms (kind, raise, deadline), all inside the hash.
fn seal(kind: &str, plan: &str, raise: &Value, deadline_ns: u64) -> String {
    let mut v: Value = serde_json::from_str(plan).unwrap();
    let o = v.as_object_mut().unwrap();
    o.insert("kind".into(), json!(kind)); o.insert("raise".into(), raise.clone()); o.insert("deadline_ns".into(), json!(deadline_ns.to_string()));
    v.to_string()
}
fn h(s: &str) -> String { Sha256::digest(s.as_bytes()).iter().map(|b| format!("{:02x}", b)).collect() }

struct Env {
    w: Worker<Sandbox>, ft: Contract, rounds: Contract,
    board: Account, treasury: Account, ada: Account, bayo: Account, chidi: Account, dayo: Account, fund: Account, efe: Account, zed: Account,
}

async fn register(ft: &Contract, who: &[&near_workspaces::AccountId]) {
    for a in who {
        ft.call("storage_deposit").args_json(json!({"account_id": a})).transact().await.unwrap().into_result().unwrap();
    }
}
async fn faucet(ft: &Contract, to: &Account, usd: u128) {
    ft.call("faucet").args_json(json!({"account_id": to.id(), "amount": (usd * USD).to_string()})).transact().await.unwrap().into_result().unwrap();
}
async fn balance(ft: &Contract, a: &near_workspaces::AccountId) -> u128 {
    ft.view("ft_balance_of").args_json(json!({"account_id": a})).await.unwrap().json::<String>().unwrap().parse().unwrap()
}

async fn setup() -> anyhow::Result<Env> {
    let w = near_workspaces::sandbox().await?;
    let root = w.root_account()?;
    let mk = |n: &'static str| { let r = root.clone(); async move { r.create_subaccount(n).initial_balance(NearToken::from_near(20)).transact().await.unwrap().into_result().unwrap() } };
    let (board, treasury, ada, bayo, chidi, dayo, fund, efe, zed) = (mk("board").await, mk("treasury").await, mk("ada").await, mk("bayo").await, mk("chidi").await, mk("dayo").await, mk("fund").await, mk("efe").await, mk("zed").await);
    let ft = w.dev_deploy(&std::fs::read(FT_WASM)?).await?;
    ft.call("new").args_json(json!({"faucet_cap": (100_000_000u128 * USD).to_string()})).transact().await?.into_result()?;
    let rounds = w.dev_deploy(&std::fs::read(ROUNDS_WASM)?).await?;
    let classes: Vec<Value> = ["Common", "SeriesA", "safe1", "safe2"].iter().map(|c| json!({"id": c, "authorized": "100000000"})).collect();
    rounds.call("new").args_json(json!({"board": board.id(), "treasury": treasury.id(), "payment_token": ft.id(), "classes": classes,
        "month_ns": 1_000_000_000u64, "exercise_window_ns": 90_000_000_000u64})).transact().await?.into_result()?;
    register(&ft, &[board.id(), treasury.id(), ada.id(), bayo.id(), chidi.id(), dayo.id(), fund.id(), efe.id(), zed.id(), rounds.id()]).await;
    for (a, d) in [(&chidi, 1_000_000u128), (&dayo, 1_000_000), (&fund, 20_000_000), (&zed, 100_000_000), (&efe, 1_000_000)] { faucet(&ft, a, d).await; }
    board.call(rounds.id(), "set_officer").args_json(json!({"account": ada.id(), "enabled": true})).transact().await?.into_result()?;
    Ok(Env { w, ft, rounds, board, treasury, ada, bayo, chidi, dayo, fund, efe, zed })
}

impl Env {
    async fn propose(&self, kind: &str, plan: &str, raise: Value) -> u64 {
        let plan = seal(kind, plan, &raise, u64::MAX);
        self.ada.call(self.rounds.id(), "propose_round").args_json(json!({"kind": kind, "plan_hash": h(&plan), "plan_uri": "ipfs://demo", "plan": plan, "raise": raise, "deadline_ns": u64::MAX}))
            .transact().await.unwrap().into_result().unwrap().json::<u64>().unwrap()
    }
    /// Hash of the plan bytes the chain holds for a round (the body the test wrote plus its sealed terms).
    async fn plan_hash(&self, round: u64, body: &str) -> String {
        let r: Value = self.rounds.view("round").args_json(json!({"round_id": round})).await.unwrap().json().unwrap();
        let plan = r["plan"].as_str().unwrap();
        let (on_chain, want): (Value, Value) = (serde_json::from_str(plan).unwrap(), serde_json::from_str(body).unwrap());
        for (k, v) in want.as_object().unwrap() { assert_eq!(&on_chain[k], v, "the chain holds the body the test proposed"); }
        h(plan)
    }
    async fn deposit(&self, who: &Account, round: u64, usd: u128) {
        who.call(self.ft.id(), "ft_transfer_call").args_json(json!({"receiver_id": self.rounds.id(), "amount": (usd * USD).to_string(), "msg": json!({"action": "round", "id": round}).to_string()}))
            .deposit(ONE).max_gas().transact().await.unwrap().into_result().unwrap();
    }
    async fn approve(&self, round: u64, plan: &str) -> bool {
        let hash = self.plan_hash(round, plan).await;
        self.board.call(self.rounds.id(), "approve_round").args_json(json!({"round_id": round, "plan_hash": hash})).transact().await.unwrap().is_success()
    }
    async fn close(&self, round: u64) -> bool {
        self.close_by(&self.efe, round).await
    }
    async fn close_by(&self, who: &Account, round: u64) -> bool {
        who.call(self.rounds.id(), "close_round").args_json(json!({"round_id": round})).gas(Gas::from_tgas(100)).transact().await.unwrap().is_success()
    }
    async fn holding(&self, holder: &str, class: &str) -> u128 {
        let v: Vec<(String, String)> = self.rounds.view("holdings_of").args_json(json!({"holder": holder})).await.unwrap().json().unwrap();
        v.into_iter().find(|(c, _)| c == class).map(|(_, s)| s.parse().unwrap()).unwrap_or(0)
    }
    async fn status(&self, round: u64) -> String {
        self.rounds.view("round").args_json(json!({"round_id": round})).await.unwrap().json::<Value>().unwrap()["status"].as_str().unwrap().to_string()
    }
    async fn number(&self, method: &str) -> u128 {
        u128::from_str_radix(&self.rounds.view(method).await.unwrap().json::<String>().unwrap(), 10).unwrap()
    }
    async fn grant(&self, shares: u128, start_ns: u64, term: u32, cliff: u32) -> bool {
        self.grant_to(&self.efe, shares, 1, start_ns, term, cliff).await
    }
    async fn grant_to(&self, who: &Account, shares: u128, strike_micro: u128, start_ns: u64, term: u32, cliff: u32) -> bool {
        let plan = json!({"grantee": who.id(), "shares": shares.to_string(), "strike_micro": strike_micro.to_string(), "start_ns": start_ns, "term_months": term, "cliff_months": cliff}).to_string();
        self.board.call(self.rounds.id(), "grant").args_json(json!({"plan_hash": h(&plan), "plan": plan})).transact().await.unwrap().is_success()
    }
    async fn terminate(&self, id: u64) {
        self.board.call(self.rounds.id(), "terminate").args_json(json!({"grant_id": id})).transact().await.unwrap().into_result().unwrap();
    }
    async fn cancel(&self, round: u64) -> bool {
        self.board.call(self.rounds.id(), "cancel_round").args_json(json!({"round_id": round})).max_gas().transact().await.unwrap().is_success()
    }
    async fn round_balance(&self) -> u128 {
        balance(&self.ft, self.rounds.id()).await
    }
}

const FOUNDER: &str = r#"{"issuances":[{"class":"Common","holder":"ada","shares":"5000000"},{"class":"Common","holder":"bayo","shares":"2750000"},{"class":"Common","holder":"unissued_pool","shares":"1000000"}]}"#;

#[tokio::test]
async fn full_round_and_exit() -> anyhow::Result<()> {
    let e = setup().await?;
    // founders (no deposits)
    let r1 = e.propose("Founder", FOUNDER, json!([])).await;
    assert!(e.approve(r1, FOUNDER).await);
    assert!(e.close(r1).await);
    assert_eq!(e.holding("ada", "Common").await, 5_000_000);
    // SAFEs: two rounds, each with escrow
    let s1 = r#"{"safes":[{"id":"safe1","holder":"chidi.test.near","amount":"500000000000","post_money_cap":"5000000000000","discount_bps":0,"converted":false}]}"#;
    let s2 = r#"{"safes":[{"id":"safe2","holder":"dayo.test.near","amount":"250000000000","post_money_cap":"10000000000000","discount_bps":0,"converted":false}]}"#;
    let (ra, rb) = (e.propose("Safe", s1, json!([[e.chidi.id(), "500000000000"]])).await, e.propose("Safe", s2, json!([[e.dayo.id(), "250000000000"]])).await);
    e.deposit(&e.chidi, ra, 500_000).await; e.deposit(&e.dayo, rb, 250_000).await;
    for (r, p) in [(ra, s1), (rb, s2)] { assert!(e.approve(r, p).await); assert!(e.close(r).await); }
    assert_eq!(balance(&e.ft, e.treasury.id()).await, 750_000 * USD, "escrow forwarded to the treasury, not the board");
    // Series A (GV-1)
    let a = r#"{"converted_safes":["safe1","safe2"],"issuances":[{"class":"safe1","holder":"chidi","shares":"1000000"},{"class":"safe2","holder":"dayo","shares":"250000"},{"class":"SeriesA","holder":"fund","shares":"4500000"},{"class":"Common","holder":"unissued_pool","shares":"500000"}]}"#;
    let rc = e.propose("Priced", a, json!([[e.fund.id(), "9000000000000"]])).await;
    e.deposit(&e.fund, rc, 9_000_000).await;
    assert!(e.approve(rc, a).await); assert!(e.close(rc).await);
    assert_eq!(e.status(rc).await, "Closed");
    assert_eq!(e.holding("fund", "SeriesA").await, 4_500_000);
    assert_eq!(e.holding("unissued_pool", "Common").await, 1_500_000);
    assert_eq!(e.holding("chidi", "safe1").await, 1_000_000);
    assert_eq!(u128::from_str_radix(&e.rounds.view("ledger_total").await?.json::<String>()?, 10)?, 0);
    // Exit at $20M (GV-2): payouts in micro-dollars
    let payouts = [("ada", 6_111_111_111_111u128), ("bayo", 3_361_111_111_111), ("chidi", 1_222_222_222_222), ("dayo", 305_555_555_555), ("fund", 9_000_000_000_000)];
    let ids = [e.ada.id().clone(), e.bayo.id().clone(), e.chidi.id().clone(), e.dayo.id().clone(), e.fund.id().clone()];
    let total: u128 = payouts.iter().map(|p| p.1).sum();
    let plan = json!({"payouts": ids.iter().zip(payouts.iter()).map(|(i, p)| json!([i, p.1.to_string()])).collect::<Vec<_>>()}).to_string();
    let x = e.ada.call(e.rounds.id(), "propose_exit").args_json(json!({"plan_hash": h(&plan), "plan_uri": "ipfs://exit", "plan": plan})).transact().await?.into_result()?.json::<u64>()?;
    e.zed.call(e.ft.id(), "ft_transfer_call").args_json(json!({"receiver_id": e.rounds.id(), "amount": total.to_string(), "msg": json!({"action": "exit", "id": x}).to_string()})).deposit(ONE).max_gas().transact().await?.into_result()?;
    // not approved yet: distribute refuses
    assert!(!e.zed.call(e.rounds.id(), "distribute").args_json(json!({"exit_id": x, "from": 0, "limit": 5})).max_gas().transact().await?.is_success());
    e.board.call(e.rounds.id(), "approve_exit").args_json(json!({"exit_id": x, "plan_hash": h(&plan)})).transact().await?.into_result()?;
    e.zed.call(e.rounds.id(), "distribute").args_json(json!({"exit_id": x, "from": 0, "limit": 5})).max_gas().transact().await?.into_result()?;
    for (i, p) in ids.iter().zip(payouts.iter()) { assert_eq!(balance(&e.ft, i).await - if *i == *e.chidi.id() || *i == *e.dayo.id() { 1_000_000 * USD } else if *i == *e.fund.id() { 20_000_000 * USD - 9_000_000 * USD } else { 0 }, p.1 - if *i == *e.chidi.id() { 500_000 * USD } else if *i == *e.dayo.id() { 250_000 * USD } else { 0 }, "payout to {}", i); }
    assert_eq!(u128::from_str_radix(&e.rounds.view("ledger_total").await?.json::<String>()?, 10)?, 0, "ledger drained exactly");
    // paying again pays nobody twice
    e.zed.call(e.rounds.id(), "distribute").args_json(json!({"exit_id": x, "from": 0, "limit": 5})).max_gas().transact().await?.into_result()?;
    assert_eq!(balance(&e.ft, e.rounds.id()).await, 0);
    let _ = &e.w;
    Ok(())
}

#[tokio::test]
async fn rounds_reject_zero_raise_duplicate_investor_and_class_overwrite() -> anyhow::Result<()> {
    let e = setup().await?;
    let plan = r#"{"issuances":[{"class":"Common","holder":"ada","shares":"1"}]}"#;
    let propose = |raise: Value| { let p = seal("Priced", plan, &raise, u64::MAX); e.ada.call(e.rounds.id(), "propose_round").args_json(json!({"kind":"Priced","plan_hash":h(&p),"plan_uri":"x","plan":p,"raise":raise,"deadline_ns":u64::MAX})).transact() };
    assert!(propose(json!([[e.fund.id(), "1"]])).await?.is_success(), "the same plan with a valid raise is accepted");
    let zero = propose(json!([[e.fund.id(), "0"]])).await?;
    assert!(!zero.is_success(), "a zero raise must not close for free");
    let dup = propose(json!([[e.fund.id(), "1"], [e.fund.id(), "1"]])).await?;
    assert!(!dup.is_success(), "a duplicate investor must be refused");
    let overwrite = e.board.call(e.rounds.id(), "add_class").args_json(json!({"class": {"id": "Common", "authorized": "1"}})).transact().await?;
    assert!(!overwrite.is_success(), "an existing class cannot be overwritten");
    let add = e.board.call(e.rounds.id(), "add_class").args_json(json!({"class": {"id": "New", "authorized": "1"}})).transact().await?;
    assert!(add.is_success(), "a new class is accepted");
    Ok(())
}

#[tokio::test]
async fn wrong_token_deposit_is_refunded() -> anyhow::Result<()> {
    let e = setup().await?;
    let other = e.w.dev_deploy(&std::fs::read(FT_WASM)?).await?;
    other.call("new").args_json(json!({"faucet_cap": "1000000000"})).transact().await?.into_result()?;
    register(&other, &[e.chidi.id(), e.rounds.id()]).await; faucet(&other, &e.chidi, 100).await;
    let plan = r#"{"safes":[{"id":"safe1","holder":"chidi.test.near","amount":"500000000","post_money_cap":"5000000000000","discount_bps":0,"converted":false}]}"#;
    let r = e.propose("Safe", plan, json!([[e.chidi.id(), "500000000"]])).await;
    e.chidi.call(other.id(), "ft_transfer_call").args_json(json!({"receiver_id": e.rounds.id(), "amount": "50000000", "msg": json!({"action":"round","id":r}).to_string()})).deposit(ONE).max_gas().transact().await?.into_result()?;
    assert_eq!(balance(&other, e.chidi.id()).await, 100 * USD, "wrong token returned in full");
    let round: Value = e.rounds.view("round").args_json(json!({"round_id": r})).await?.json()?;
    assert_eq!(round["deposits"][0][1], "0");
    // a correct deposit above the requested amount returns the excess
    faucet(&e.ft, &e.chidi, 0).await;
    let before = balance(&e.ft, e.chidi.id()).await;
    e.chidi.call(e.ft.id(), "ft_transfer_call").args_json(json!({"receiver_id": e.rounds.id(), "amount": "900000000", "msg": json!({"action":"round","id":r}).to_string()})).deposit(ONE).max_gas().transact().await?.into_result()?;
    assert_eq!(before - balance(&e.ft, e.chidi.id()).await, 500_000_000, "only the requested amount is kept");
    Ok(())
}

#[tokio::test]
async fn auth_hash_and_replay() -> anyhow::Result<()> {
    let e = setup().await?;
    // stranger cannot approve; hash mismatch rejected; non-officer cannot propose
    let r = e.propose("Founder", FOUNDER, json!([])).await;
    let fh = e.plan_hash(r, FOUNDER).await;
    assert!(!e.fund.call(e.rounds.id(), "approve_round").args_json(json!({"round_id": r, "plan_hash": fh})).transact().await?.is_success(), "non-board approve fails");
    assert!(!e.board.call(e.rounds.id(), "approve_round").args_json(json!({"round_id": r, "plan_hash": h("other")})).transact().await?.is_success(), "hash mismatch fails");
    let sealed = seal("Founder", FOUNDER, &json!([]), u64::MAX);
    assert!(!e.fund.call(e.rounds.id(), "propose_round").args_json(json!({"kind":"Founder","plan_hash":h(&sealed),"plan_uri":"x","plan":sealed,"raise":[],"deadline_ns":u64::MAX})).transact().await?.is_success(), "non-officer propose fails");
    assert!(!e.ada.call(e.rounds.id(), "propose_round").args_json(json!({"kind":"Founder","plan_hash":h("x"),"plan_uri":"x","plan":sealed,"raise":[],"deadline_ns":u64::MAX})).transact().await?.is_success(), "proposed plan must match its hash");
    // cannot close before approval
    assert!(!e.close(r).await);
    assert!(e.approve(r, FOUNDER).await);
    assert!(!e.approve(r, FOUNDER).await, "approve cannot repeat");
    assert!(e.close(r).await);
    // double close does nothing
    assert!(!e.close(r).await);
    assert_eq!(e.holding("ada", "Common").await, 5_000_000);
    // outsiders cannot call callbacks
    for (m, a) in [("on_close", json!({"round_id": r, "total": "0"})), ("on_payout", json!({"exit_id": 1, "index": 0})), ("on_refund", json!({"round_id": r, "investor": e.ada.id(), "amount": "1"})), ("on_exit_refund", json!({"exit_id": 1, "funder": e.ada.id(), "amount": "1"}))] {
        assert!(!e.efe.call(e.rounds.id(), m).args_json(a).max_gas().transact().await?.is_success(), "{} must be private", m);
    }
    Ok(())
}

#[tokio::test]
async fn refunds_are_exact_and_hostile_token_leaves_retryable_state() -> anyhow::Result<()> {
    let e = setup().await?;
    let plan = r#"{"safes":[{"id":"safe1","holder":"chidi.test.near","amount":"500000000000","post_money_cap":"5000000000000","discount_bps":0,"converted":false}]}"#;
    let r = e.propose("Safe", plan, json!([[e.chidi.id(), "500000000000"]])).await;
    e.deposit(&e.chidi, r, 500_000).await;
    assert!(e.approve(r, plan).await);
    // hostile token: transfer to treasury fails during close -> round stays Approved, funds stay in custody
    e.ft.call("set_fail_transfers").args_json(json!({"fail": true})).transact().await?.into_result()?;
    let res = e.close(r).await; let _ = res;
    assert_eq!(e.status(r).await, "Approved", "retryable after failed transfer");
    assert_eq!(e.holding("chidi", "safe1").await, 0);
    assert_eq!(balance(&e.ft, e.rounds.id()).await, 500_000 * USD);
    e.ft.call("set_fail_transfers").args_json(json!({"fail": false})).transact().await?.into_result()?;
    // cancel now: refund exactly, then nothing more is refundable
    let before = balance(&e.ft, e.chidi.id()).await;
    e.board.call(e.rounds.id(), "cancel_round").args_json(json!({"round_id": r})).max_gas().transact().await?.into_result()?;
    assert_eq!(balance(&e.ft, e.chidi.id()).await - before, 500_000 * USD, "refund is exact");
    assert_eq!(balance(&e.ft, e.rounds.id()).await, 0);
    assert!(!e.efe.call(e.rounds.id(), "retry_refund").args_json(json!({"round_id": r, "investor": e.chidi.id()})).max_gas().transact().await?.is_success(), "no double refund");
    assert_eq!(u128::from_str_radix(&e.rounds.view("ledger_total").await?.json::<String>()?, 10)?, 0);
    Ok(())
}

#[tokio::test]
async fn distribution_resumes_after_failed_transfer() -> anyhow::Result<()> {
    let e = setup().await?;
    let plan = json!({"payouts": [[e.ada.id(), "100000000"], [e.bayo.id(), "50000000"]]}).to_string();
    let x = e.ada.call(e.rounds.id(), "propose_exit").args_json(json!({"plan_hash": h(&plan), "plan_uri": "x", "plan": plan})).transact().await?.into_result()?.json::<u64>()?;
    e.zed.call(e.ft.id(), "ft_transfer_call").args_json(json!({"receiver_id": e.rounds.id(), "amount": "150000000", "msg": json!({"action":"exit","id":x}).to_string()})).deposit(ONE).max_gas().transact().await?.into_result()?;
    e.board.call(e.rounds.id(), "approve_exit").args_json(json!({"exit_id": x, "plan_hash": h(&plan)})).transact().await?.into_result()?;
    e.ft.call("set_fail_transfers").args_json(json!({"fail": true})).transact().await?.into_result()?;
    let _ = e.zed.call(e.rounds.id(), "distribute").args_json(json!({"exit_id": x, "from": 0, "limit": 2})).max_gas().transact().await?;
    assert_eq!(balance(&e.ft, e.rounds.id()).await, 150 * USD, "nothing left custody");
    let ex: Value = e.rounds.view("exit").args_json(json!({"exit_id": x})).await?.json()?;
    assert!(ex["payouts"].as_array().unwrap().iter().all(|p| p["state"] == "Pending"), "failed payouts stay retryable");
    e.ft.call("set_fail_transfers").args_json(json!({"fail": false})).transact().await?.into_result()?;
    let (a0, b0) = (balance(&e.ft, e.ada.id()).await, balance(&e.ft, e.bayo.id()).await);
    e.zed.call(e.rounds.id(), "distribute").args_json(json!({"exit_id": x, "from": 0, "limit": 2})).max_gas().transact().await?.into_result()?;
    assert_eq!(balance(&e.ft, e.ada.id()).await - a0, 100 * USD);
    assert_eq!(balance(&e.ft, e.bayo.id()).await - b0, 50 * USD);
    Ok(())
}

#[tokio::test]
async fn grant_vesting_exercise_and_termination() -> anyhow::Result<()> {
    let e = setup().await?;
    let r = e.propose("Founder", FOUNDER, json!([])).await;
    assert!(e.approve(r, FOUNDER).await); assert!(e.close(r).await);
    let now = e.w.view_block().await?.timestamp();
    let plan = json!({"grantee": e.efe.id(), "shares": "48000", "strike_micro": "2000000", "start_ns": now, "term_months": 48, "cliff_months": 12}).to_string();
    assert!(!e.fund.call(e.rounds.id(), "grant").args_json(json!({"plan_hash": h(&plan), "plan": plan})).transact().await?.is_success(), "only the board grants");
    let g = e.board.call(e.rounds.id(), "grant").args_json(json!({"plan_hash": h(&plan), "plan": plan})).transact().await?.into_result()?.json::<u64>()?;
    let v0: String = e.rounds.view("vested").args_json(json!({"grant_id": g})).await?.json()?;
    assert_eq!(v0, "0", "nothing before the cliff");
    // exercising unvested shares is refused and the payment returned
    let before = balance(&e.ft, e.efe.id()).await;
    e.efe.call(e.ft.id(), "ft_transfer_call").args_json(json!({"receiver_id": e.rounds.id(), "amount": "2000000", "msg": json!({"action":"exercise","id":g,"shares":"1"}).to_string()})).deposit(ONE).max_gas().transact().await?.into_result()?;
    assert_eq!(balance(&e.ft, e.efe.id()).await, before);
    // advance 13 simulated months (1 s each in this config)
    e.w.fast_forward(40).await?;
    let v: String = e.rounds.view("vested").args_json(json!({"grant_id": g})).await?.json()?;
    let vested: u128 = v.parse()?; assert!(vested >= 12_000 && vested <= 48_000, "vested {}", vested);
    e.efe.call(e.ft.id(), "ft_transfer_call").args_json(json!({"receiver_id": e.rounds.id(), "amount": (2_000_000u128 * 1000).to_string(), "msg": json!({"action":"exercise","id":g,"shares":"1000"}).to_string()})).deposit(ONE).max_gas().transact().await?.into_result()?;
    assert_eq!(e.holding(&e.efe.id().to_string(), "Common").await, 1000, "exercise credits common");
    assert_eq!(e.holding("unissued_pool", "Common").await, 1_000_000 - 1000, "exercise draws from the pool instead of minting");
    assert_eq!(e.holding("unissued_pool", "Common").await + e.holding(&e.efe.id().to_string(), "Common").await, 1_000_000, "total common shares are unchanged by an exercise");
    let strike: String = e.rounds.view("strike_balance").await?.json()?;
    assert_eq!(strike.parse::<u128>()?, 2_000_000 * 1000, "strike is held until swept");
    // a failed sweep must leave the balance and the tokens in the contract, then be retryable
    e.ft.call("set_fail_transfers").args_json(json!({"fail": true})).transact().await?.into_result()?;
    let held = balance(&e.ft, e.rounds.id()).await;
    let _ = e.board.call(e.rounds.id(), "withdraw_strikes").args_json(json!({"amount": (2_000_000u128 * 1000).to_string()})).max_gas().transact().await?;
    assert_eq!(e.rounds.view("strike_balance").await?.json::<String>()?.parse::<u128>()?, 2_000_000 * 1000, "failed sweep is re-credited");
    assert_eq!(balance(&e.ft, e.rounds.id()).await, held, "failed sweep moves no tokens");
    e.ft.call("set_fail_transfers").args_json(json!({"fail": false})).transact().await?.into_result()?;
    let t0 = balance(&e.ft, e.treasury.id()).await;
    e.board.call(e.rounds.id(), "withdraw_strikes").args_json(json!({"amount": (2_000_000u128 * 1000).to_string()})).max_gas().transact().await?.into_result()?;
    assert_eq!(balance(&e.ft, e.treasury.id()).await - t0, 2_000_000 * 1000, "strike reaches the treasury");
    assert_eq!(u128::from_str_radix(&e.rounds.view("ledger_total").await?.json::<String>()?, 10)?, 0, "ledger drained after the strike sweep");
    Ok(())
}

/// Overlapping grants are claims on the same pool: they must not promise more shares than exist, and a
/// termination must free the unvested part while keeping the vested part claimable until its window ends.
#[tokio::test]
async fn grants_cannot_overcommit_the_pool() -> anyhow::Result<()> {
    let e = setup().await?;
    let r = e.propose("Founder", FOUNDER, json!([])).await;
    assert!(e.approve(r, FOUNDER).await); assert!(e.close(r).await);
    let now = e.w.view_block().await?.timestamp();
    assert!(e.grant(600_000, now, 48, 12).await, "first claim fits");
    assert!(!e.grant(500_000, now, 48, 12).await, "a second claim cannot exceed the pool");
    assert_eq!(e.number("open_claims").await, 600_000);
    assert_eq!(e.number("pool_available").await, 400_000);
    assert!(e.grant(400_000, now, 48, 12).await, "the remaining pool can be claimed");
    assert!(!e.grant(1, now, 48, 12).await, "the pool is fully claimed");
    assert_eq!(e.number("open_claims").await, 1_000_000);
    // all of grant 1 is unvested at termination, so its claim lapses immediately and can be reused
    e.terminate(1).await;
    assert_eq!(e.number("open_claims").await, 400_000);
    assert!(e.grant(600_000, now, 48, 12).await, "lapsed shares can be granted again");
    e.terminate(3).await;
    assert_eq!(e.number("open_claims").await, 400_000);
    // a fully vested grant keeps its claim for the exercise window, then lapses
    let past = now.saturating_sub(1_000_000_000_000);
    assert!(e.grant(100_000, past, 1, 0).await);
    assert_eq!(e.number("open_claims").await, 500_000);
    e.terminate(4).await;
    assert_eq!(e.number("open_claims").await, 500_000, "vested shares stay claimable during the window");
    e.w.fast_forward(400).await?;
    assert_eq!(e.number("open_claims").await, 400_000, "the expired claim lapses; the active grant remains");
    Ok(())
}

/// A funded round with a big plan must close (the callback that credits shares needs enough gas), never stick in Closing with the money gone.
#[tokio::test]
async fn large_funded_round_closes_and_credits_everything() -> anyhow::Result<()> {
    let e = setup().await?;
    let issuances: Vec<Value> = (0..60).map(|i| json!({"class": "Common", "holder": format!("holder{}", i), "shares": "1000"})).collect();
    let plan = json!({"converted_safes": [], "issuances": issuances}).to_string();
    let r = e.propose("Priced", &plan, json!([[e.fund.id(), "9000000000000"]])).await;
    e.deposit(&e.fund, r, 9_000_000).await;
    assert!(e.approve(r, &plan).await);
    let ok = e.efe.call(e.rounds.id(), "close_round").args_json(json!({"round_id": r})).gas(Gas::from_tgas(100)).transact().await?; // the gas the demo script attaches
    assert!(ok.is_success(), "close_round itself succeeds");
    assert_eq!(e.status(r).await, "Closed", "the round must finish closing, not stay Closing");
    assert_eq!(e.holding("holder59", "Common").await, 1_000);
    assert_eq!(u128::from_str_radix(&e.rounds.view("ledger_total").await?.json::<String>()?, 10)?, 0);
    Ok(())
}

/// Two separately approved, funded rounds that name the same SAFE id must not both move money and then have
/// the second callback panic with the round stuck in Closing.
#[tokio::test]
async fn concurrent_close_cannot_convert_the_same_safe_twice() -> anyhow::Result<()> {
    let e = setup().await?;
    let safe = r#"{"safes":[{"id":"safe1","holder":"chidi.test.near","amount":"500000000000","post_money_cap":"5000000000000","discount_bps":0,"converted":false}]}"#;
    let r1 = e.propose("Safe", safe, json!([[e.chidi.id(), "500000000000"]])).await;
    let r2 = e.propose("Safe", safe, json!([[e.chidi.id(), "500000000000"]])).await;
    e.deposit(&e.chidi, r1, 500_000).await;
    e.deposit(&e.chidi, r2, 500_000).await;
    assert!(e.approve(r1, safe).await);
    assert!(e.approve(r2, safe).await);
    // two different signers close at once (close_round is permissionless)
    let (a, b) = tokio::join!(e.close_by(&e.efe, r1), e.close_by(&e.zed, r2));
    assert!(a ^ b, "exactly one close may win (got {a}, {b})");
    let (wa, wb) = (e.status(r1).await, e.status(r2).await);
    assert!(wa == "Closed" || wb == "Closed", "one round closed ({wa}, {wb})");
    assert!(wa != "Closing" && wb != "Closing", "no round may stay stuck in Closing ({wa}, {wb})");
    let rec: Value = e.rounds.view("safe").args_json(json!({"id": "safe1"})).await?.json()?;
    assert_eq!(rec["holder"], e.chidi.id().to_string(), "safe1 was created exactly once");
    assert_eq!(balance(&e.ft, e.treasury.id()).await, 500_000 * USD, "only one escrow was forwarded");
    assert_eq!(u128::from_str_radix(&e.rounds.view("ledger_total").await?.json::<String>()?, 10)?, 500_000 * USD, "the losing deposit is still in custody");
    Ok(())
}

/// A plan that can never be credited (above the authorized shares) must be refused BEFORE any money moves.
#[tokio::test]
async fn close_that_cannot_credit_does_not_move_money() -> anyhow::Result<()> {
    let e = setup().await?;
    let plan = r#"{"converted_safes":[],"issuances":[{"class":"Common","holder":"fund","shares":"200000000"}]}"#;
    let r = e.propose("Priced", plan, json!([[e.fund.id(), "9000000000000"]])).await;
    e.deposit(&e.fund, r, 9_000_000).await;
    assert!(e.approve(r, plan).await);
    let before = balance(&e.ft, e.board.id()).await;
    let res = e.efe.call(e.rounds.id(), "close_round").args_json(json!({"round_id": r})).max_gas().transact().await?;
    assert!(!res.is_success(), "closing a round that cannot be credited must be refused");
    assert_eq!(e.status(r).await, "Approved", "the round stays retryable");
    assert_eq!(balance(&e.ft, e.board.id()).await, before, "no money moved to the board");
    assert_eq!(u128::from_str_radix(&e.rounds.view("ledger_total").await?.json::<String>()?, 10)?, 9_000_000 * USD, "the escrow is intact");
    Ok(())
}

/// A cancel racing a close must never both refund the investor and forward the escrow: a Closing round cannot be
/// cancelled, and a cancelled round cannot be closed.
#[tokio::test]
async fn cancel_cannot_race_a_close() -> anyhow::Result<()> {
    let e = setup().await?;
    let safe = r#"{"safes":[{"id":"safe1","holder":"chidi.test.near","amount":"500000000000","post_money_cap":"5000000000000","discount_bps":0,"converted":false}]}"#;
    let r = e.propose("Safe", safe, json!([[e.chidi.id(), "500000000000"]])).await;
    e.deposit(&e.chidi, r, 500_000).await;
    assert!(e.approve(r, safe).await);
    let chidi_before = balance(&e.ft, e.chidi.id()).await;
    let (closed, cancelled) = tokio::join!(e.close_by(&e.efe, r), e.cancel(r));
    let st = e.status(r).await;
    assert!(st == "Closed" || st == "Cancelled", "round must settle, got {st}");
    assert!(closed ^ cancelled, "exactly one of close/cancel wins (got {closed}, {cancelled})");
    e.w.fast_forward(5).await?;
    let (treasury, chidi) = (balance(&e.ft, e.treasury.id()).await, balance(&e.ft, e.chidi.id()).await);
    if st == "Closed" { assert_eq!((treasury, chidi), (500_000 * USD, chidi_before), "closed: escrow forwarded, no refund"); }
    else { assert_eq!((treasury, chidi), (0, chidi_before + 500_000 * USD), "cancelled: refunded, nothing forwarded"); }
    assert_eq!(e.round_balance().await, 0, "the contract holds nothing for this round");
    assert_eq!(e.number("ledger_total").await, 0);
    Ok(())
}

/// A grant needs an `unissued_pool` holding; without one it is refused rather than creating an unbacked claim.
#[tokio::test]
async fn grant_without_a_pool_is_refused() -> anyhow::Result<()> {
    let e = setup().await?;
    let now = e.w.view_block().await?.timestamp();
    assert!(!e.grant(1, now, 48, 12).await, "no pool, no grant");
    assert_eq!(e.number("open_claims").await, 0);
    Ok(())
}

/// The board approves a hash; that hash must cover the money terms too. A proposal whose raise, kind or deadline
/// differs from the ones inside the hashed plan is refused, so an approved share plan cannot be paired with a $1 raise.
#[tokio::test]
async fn plan_hash_binds_raise_kind_and_deadline() -> anyhow::Result<()> {
    let e = setup().await?;
    let body = r#"{"converted_safes":[],"issuances":[{"class":"SeriesA","holder":"fund","shares":"4500000"}]}"#;
    let full = json!([[e.fund.id(), "9000000000000"]]);
    let plan = seal("Priced", body, &full, 1_900_000_000_000_000_000);
    let send = |kind: &'static str, plan: String, raise: Value, deadline: u64| e.ada.call(e.rounds.id(), "propose_round")
        .args_json(json!({"kind": kind, "plan_hash": h(&plan), "plan_uri": "x", "plan": plan, "raise": raise, "deadline_ns": deadline})).transact();
    assert!(!send("Priced", plan.clone(), json!([[e.fund.id(), "1"]]), 1_900_000_000_000_000_000).await?.is_success(), "a $9M plan cannot be proposed with a tiny raise");
    assert!(!send("Priced", plan.clone(), json!([[e.zed.id(), "9000000000000"]]), 1_900_000_000_000_000_000).await?.is_success(), "nor with another investor");
    assert!(!send("Safe", plan.clone(), full.clone(), 1_900_000_000_000_000_000).await?.is_success(), "nor as another kind of round");
    assert!(!send("Priced", plan.clone(), full.clone(), u64::MAX).await?.is_success(), "nor with another deadline");
    assert!(!send("Priced", body.to_string(), full.clone(), 1_900_000_000_000_000_000).await?.is_success(), "a plan without its terms is refused");
    let ok = send("Priced", plan.clone(), full.clone(), 1_900_000_000_000_000_000).await?;
    assert!(ok.is_success(), "the matching terms are accepted");
    let r: Value = e.rounds.view("round").args_json(json!({"round_id": ok.json::<u64>()?})).await?.json()?;
    assert_eq!(r["plan_hash"], h(&plan)); assert_eq!(r["raise"], full);
    // a SAFE round: the investor pays exactly the SAFE's purchase amount
    let safe = r#"{"safes":[{"id":"safe1","holder":"chidi.test.near","amount":"500000000000","post_money_cap":"5000000000000","discount_bps":0,"converted":false}]}"#;
    let cheap = json!([[e.chidi.id(), "1"]]);
    let p = seal("Safe", safe, &cheap, u64::MAX);
    assert!(!send("Safe", p, cheap, u64::MAX).await?.is_success(), "a $500,000 SAFE cannot be bought for less, even if the plan says so");
    Ok(())
}

/// Cancelling a round with many investors must not fail for gas: the cancel refunds what its gas covers and the
/// rest are pulled with `retry_refund`, each exactly once.
#[tokio::test]
async fn cancel_with_many_investors_refunds_everyone() -> anyhow::Result<()> {
    let e = setup().await?;
    let root = e.w.root_account()?;
    let mut investors = vec![];
    for i in 0..12 {
        let a = root.create_subaccount(&format!("inv{}", i)).initial_balance(NearToken::from_near(5)).transact().await?.into_result()?;
        register(&e.ft, &[a.id()]).await; faucet(&e.ft, &a, 1_000).await;
        investors.push(a);
    }
    let raise = Value::Array(investors.iter().map(|a| json!([a.id(), (1_000 * USD).to_string()])).collect());
    let r = e.propose("Priced", r#"{"converted_safes":[],"issuances":[{"class":"SeriesA","holder":"pool","shares":"12"}]}"#, raise).await;
    for a in &investors { e.deposit(a, r, 1_000).await; }
    assert_eq!(e.number("ledger_total").await, 12_000 * USD);
    assert!(e.cancel(r).await, "the cancel itself succeeds with 12 depositors");
    assert_eq!(e.status(r).await, "Cancelled");
    let mut refunded = 0;
    for a in &investors { if balance(&e.ft, a.id()).await == 1_000 * USD { refunded += 1; } }
    assert_eq!(refunded, 8, "the cancel refunds MAX_REFUNDS_PER_CALL investors itself");
    for a in &investors {
        if balance(&e.ft, a.id()).await == 1_000 * USD { continue }
        e.efe.call(e.rounds.id(), "retry_refund").args_json(json!({"round_id": r, "investor": a.id()})).max_gas().transact().await?.into_result()?;
    }
    for a in &investors {
        assert_eq!(balance(&e.ft, a.id()).await, 1_000 * USD, "{} has the deposit back", a.id());
        assert!(!e.efe.call(e.rounds.id(), "retry_refund").args_json(json!({"round_id": r, "investor": a.id()})).max_gas().transact().await?.is_success(), "no double refund");
    }
    assert_eq!(e.round_balance().await, 0);
    assert_eq!(e.number("ledger_total").await, 0);
    // a cancel with little gas still cancels and leaves every refund pullable
    let r2 = e.propose("Priced", r#"{"converted_safes":[],"issuances":[{"class":"SeriesA","holder":"pool","shares":"1"}]}"#, json!([[investors[0].id(), (1_000 * USD).to_string()]])).await;
    e.deposit(&investors[0], r2, 1_000).await;
    assert!(e.board.call(e.rounds.id(), "cancel_round").args_json(json!({"round_id": r2})).gas(Gas::from_tgas(20)).transact().await?.is_success(), "a low-gas cancel succeeds");
    assert_eq!(balance(&e.ft, investors[0].id()).await, 0, "no refund fitted in that gas");
    e.efe.call(e.rounds.id(), "retry_refund").args_json(json!({"round_id": r2, "investor": investors[0].id()})).max_gas().transact().await?.into_result()?;
    assert_eq!(balance(&e.ft, investors[0].id()).await, 1_000 * USD);
    Ok(())
}

/// Money paid into an exit the board calls off is not stranded: funders take back exactly what they paid, once.
#[tokio::test]
async fn cancelled_exit_refunds_its_funders() -> anyhow::Result<()> {
    let e = setup().await?;
    let plan = json!({"payouts": [[e.ada.id(), "100000000"], [e.bayo.id(), "50000000"]]}).to_string();
    let x = e.ada.call(e.rounds.id(), "propose_exit").args_json(json!({"plan_hash": h(&plan), "plan_uri": "x", "plan": plan})).transact().await?.into_result()?.json::<u64>()?;
    let fund = |who: &Account, amt: &str| who.call(e.ft.id(), "ft_transfer_call").args_json(json!({"receiver_id": e.rounds.id(), "amount": amt, "msg": json!({"action":"exit","id":x}).to_string()})).deposit(ONE).max_gas().transact();
    let (z0, f0) = (balance(&e.ft, e.zed.id()).await, balance(&e.ft, e.fund.id()).await);
    fund(&e.zed, "100000000").await?.into_result()?; fund(&e.fund, "20000000").await?.into_result()?;
    assert_eq!(e.number("ledger_total").await, 120 * USD);
    let refund = |who: &Account| e.efe.call(e.rounds.id(), "refund_exit").args_json(json!({"exit_id": x, "funder": who.id()})).max_gas().transact();
    assert!(!refund(&e.zed).await?.is_success(), "no refund while the exit is live");
    assert!(!e.efe.call(e.rounds.id(), "cancel_exit").args_json(json!({"exit_id": x})).transact().await?.is_success(), "only the board cancels an exit");
    e.board.call(e.rounds.id(), "cancel_exit").args_json(json!({"exit_id": x})).transact().await?.into_result()?;
    assert!(!e.board.call(e.rounds.id(), "approve_exit").args_json(json!({"exit_id": x, "plan_hash": h(&plan)})).transact().await?.is_success(), "a cancelled exit cannot be approved");
    assert!(!e.zed.call(e.rounds.id(), "distribute").args_json(json!({"exit_id": x, "from": 0, "limit": 2})).max_gas().transact().await?.is_success(), "nor paid out");
    let before = balance(&e.ft, e.zed.id()).await;
    fund(&e.zed, "1000000").await?.into_result()?;
    assert_eq!(balance(&e.ft, e.zed.id()).await, before, "nor funded any further");
    // a failed refund transfer leaves the claim in place
    e.ft.call("set_fail_transfers").args_json(json!({"fail": true})).transact().await?.into_result()?;
    let _ = refund(&e.zed).await?;
    assert_eq!(e.number("ledger_total").await, 120 * USD, "a failed refund keeps the money on the ledger");
    e.ft.call("set_fail_transfers").args_json(json!({"fail": false})).transact().await?.into_result()?;
    refund(&e.zed).await?.into_result()?; refund(&e.fund).await?.into_result()?;
    assert_eq!((balance(&e.ft, e.zed.id()).await, balance(&e.ft, e.fund.id()).await), (z0, f0), "each funder has exactly their money back");
    assert!(!refund(&e.zed).await?.is_success(), "no double refund");
    assert!(!refund(&e.ada).await?.is_success(), "a non-funder gets nothing");
    assert_eq!(e.round_balance().await, 0);
    assert_eq!(e.number("ledger_total").await, 0);
    // an exit whose payouts have started cannot be cancelled
    let x2 = e.ada.call(e.rounds.id(), "propose_exit").args_json(json!({"plan_hash": h(&plan), "plan_uri": "x", "plan": plan})).transact().await?.into_result()?.json::<u64>()?;
    e.zed.call(e.ft.id(), "ft_transfer_call").args_json(json!({"receiver_id": e.rounds.id(), "amount": "150000000", "msg": json!({"action":"exit","id":x2}).to_string()})).deposit(ONE).max_gas().transact().await?.into_result()?;
    e.board.call(e.rounds.id(), "approve_exit").args_json(json!({"exit_id": x2, "plan_hash": h(&plan)})).transact().await?.into_result()?;
    e.zed.call(e.rounds.id(), "distribute").args_json(json!({"exit_id": x2, "from": 0, "limit": 1})).max_gas().transact().await?.into_result()?;
    assert!(!e.board.call(e.rounds.id(), "cancel_exit").args_json(json!({"exit_id": x2})).transact().await?.is_success(), "payouts have started");
    Ok(())
}
