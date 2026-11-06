//! Test-only NEP-141 token (6 decimals) with a public faucet, storage registration and a
//! switch that makes ft_transfer fail (hostile token stub). Holds no value; testnet/sandbox only.
use near_sdk::json_types::U128;
use near_sdk::store::LookupMap;
use near_sdk::{env, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue, PromiseError};

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Ft { balances: LookupMap<AccountId, u128>, fail_transfers: bool, faucet_cap: u128 }

#[near]
impl Ft {
    #[init]
    pub fn new(faucet_cap: U128) -> Self { Self { balances: LookupMap::new(b"b"), fail_transfers: false, faucet_cap: faucet_cap.0 } }
    pub fn storage_deposit(&mut self, account_id: Option<AccountId>) {
        let a = account_id.unwrap_or_else(env::predecessor_account_id);
        if self.balances.get(&a).is_none() { self.balances.insert(a, 0); }
    }
    /// Public faucet: anyone may mint up to the cap per call to a registered account.
    pub fn faucet(&mut self, account_id: AccountId, amount: U128) {
        require!(amount.0 <= self.faucet_cap, "above faucet cap");
        let b = *self.balances.get(&account_id).unwrap_or_else(|| env::panic_str("not registered"));
        self.balances.insert(account_id, b + amount.0);
    }
    pub fn set_fail_transfers(&mut self, fail: bool) { self.fail_transfers = fail; }
    pub fn ft_balance_of(&self, account_id: AccountId) -> U128 { U128(self.balances.get(&account_id).copied().unwrap_or(0)) }
    fn xfer(&mut self, from: &AccountId, to: &AccountId, amount: u128) {
        require!(!self.fail_transfers, "hostile token: transfer failed");
        let f = *self.balances.get(from).unwrap_or_else(|| env::panic_str("sender not registered"));
        require!(self.balances.get(to).is_some(), "receiver not registered");
        require!(f >= amount, "insufficient balance");
        self.balances.insert(from.clone(), f - amount);
        let t = *self.balances.get(to).unwrap(); self.balances.insert(to.clone(), t + amount);
    }
    #[payable]
    pub fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128) {
        require!(env::attached_deposit() == NearToken::from_yoctonear(1), "attach 1 yocto");
        self.xfer(&env::predecessor_account_id(), &receiver_id, amount.0);
    }
    #[payable]
    pub fn ft_transfer_call(&mut self, receiver_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        require!(env::attached_deposit() == NearToken::from_yoctonear(1), "attach 1 yocto");
        let sender = env::predecessor_account_id();
        self.xfer(&sender, &receiver_id, amount.0);
        PromiseOrValue::Promise(
            Promise::new(receiver_id.clone())
                .function_call("ft_on_transfer", format!("{{\"sender_id\":\"{}\",\"amount\":\"{}\",\"msg\":{}}}", sender, amount.0, near_sdk::serde_json::to_string(&msg).unwrap()).into_bytes(), NearToken::from_yoctonear(0), Gas::from_tgas(80))
                .then(Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(15)).resolve(sender, receiver_id, amount)))
    }
    #[private]
    pub fn resolve(&mut self, sender: AccountId, receiver: AccountId, amount: U128, #[callback_result] unused: Result<U128, PromiseError>) -> U128 {
        let unused = match unused { Ok(u) => u.0.min(amount.0), Err(_) => amount.0 }; // failed receiver: refund all
        if unused > 0 {
            let r = *self.balances.get(&receiver).unwrap_or(&0);
            let back = unused.min(r);
            if back > 0 { self.balances.insert(receiver, r - back); let s = *self.balances.get(&sender).unwrap_or(&0); self.balances.insert(sender, s + back); }
        }
        U128(amount.0 - unused)
    }
}
