//! OPEN BOARD: a stand-in "board" for the judge sandbox only. Anyone may ask it to call one Rounds contract with a short
//! list of board methods. Sputnik DAO cannot give every visitor a vote (its "Everyone" role cannot be counted), so the
//! sandbox uses this instead; the demo run keeps its real 2-of-3 Sputnik DAO. Testnet, no value, never use for real money.
use near_sdk::{near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise};

const ALLOWED: [&str; 12] = ["set_officer", "approve_round", "approve_exit", "cancel_round", "cancel_exit", "add_class", "terminate", "withdraw_strikes", "set_project_token", "convert_safts", "grant_tokens", "terminate_token_grant"];

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct OpenBoard { target: AccountId }

#[near]
impl OpenBoard {
    #[init]
    pub fn new(target: AccountId) -> Self { Self { target } }
    /// The one Rounds contract this board acts for.
    pub fn target(&self) -> AccountId { self.target.clone() }
    pub fn open_board(&self) -> bool { true }
    /// Anyone may call. The Rounds contract sees this contract as the caller, i.e. as its board.
    pub fn act(&mut self, method_name: String, args: String, gas_tgas: u64) -> Promise {
        require!(ALLOWED.contains(&method_name.as_str()), "method not allowed on the open board");
        require!((10..=200).contains(&gas_tgas), "gas_tgas must be 10..=200");
        Promise::new(self.target.clone()).function_call(method_name, args.into_bytes(), NearToken::from_yoctonear(0), Gas::from_tgas(gas_tgas))
    }
}
