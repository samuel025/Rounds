use near_sdk::{env, near, AccountId, PanicOnDefault};

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Stub { board: AccountId, last_predecessor: Option<AccountId>, last_hash: Option<String>, last_gas: u64 }

#[near]
impl Stub {
    #[init]
    pub fn new(board: AccountId) -> Self { Self { board, last_predecessor: None, last_hash: None, last_gas: 0 } }
    pub fn approve_round(&mut self, round_id: u64, plan_hash: String) {
        assert_eq!(env::predecessor_account_id(), self.board, "only the board");
        env::log_str(&format!("approved round {} hash {} prepaid_gas {}", round_id, plan_hash, env::prepaid_gas().as_gas()));
        self.last_predecessor = Some(env::predecessor_account_id());
        self.last_hash = Some(plan_hash);
        self.last_gas = env::prepaid_gas().as_gas();
    }
    pub fn last(&self) -> (Option<AccountId>, Option<String>, u64) { (self.last_predecessor.clone(), self.last_hash.clone(), self.last_gas) }
}
