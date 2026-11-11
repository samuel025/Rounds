//! Confidential mode on the sandbox: a Groth16-verified private cap table, a DAO-approved private exit, and private claims paid to
//! brand-new accounts. The proofs come from `scripts/zk-fixtures.ts` (real snarkjs proofs for the circuits in circuits/).
use near_workspaces::{network::Sandbox, types::{Gas, NearToken}, Account, Contract, Worker};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const ROUNDS_WASM: &str = "../target/near/rounds.wasm";
const FT_WASM: &str = "../mock-ft/target/near/mock_ft.wasm";
const ONE: NearToken = NearToken::from_yoctonear(1);
const USD: u128 = 1_000_000;

fn h(s: &str) -> String { Sha256::digest(s.as_bytes()).iter().map(|b| format!("{:02x}", b)).collect() }
fn fx() -> Value { serde_json::from_str(&std::fs::read_to_string("fixtures/zk.json").expect("run `npx vite-node scripts/zk-fixtures.ts` first")).unwrap() }

struct Env { w: Worker<Sandbox>, ft: Contract, rounds: Contract, board: Account, treasury: Account, ada: Account, zed: Account, investor: Account }

async fn account(w: &Worker<Sandbox>, name: &str) -> Account { w.root_account().unwrap().create_subaccount(name).initial_balance(NearToken::from_near(20)).transact().await.unwrap().into_result().unwrap() }
async fn register(ft: &Contract, who: &near_workspaces::AccountId) { ft.call("storage_deposit").args_json(json!({"account_id": who})).transact().await.unwrap().into_result().unwrap(); }
async fn balance(ft: &Contract, who: &near_workspaces::AccountId) -> u128 { ft.view("ft_balance_of").args_json(json!({"account_id": who})).await.unwrap().json::<String>().unwrap().parse().unwrap() }

async fn setup() -> anyhow::Result<Env> {
    let w = near_workspaces::sandbox().await?;
    let (board, treasury, ada, zed, investor) = (account(&w, "board").await, account(&w, "treasury").await, account(&w, "ada").await, account(&w, "zed").await, account(&w, "investor").await);
    let ft = w.dev_deploy(&std::fs::read(FT_WASM)?).await?;
    ft.call("new").args_json(json!({"faucet_cap": (100_000_000u128 * USD).to_string()})).transact().await?.into_result()?;
    let rounds = w.dev_deploy(&std::fs::read(ROUNDS_WASM)?).await?;
    rounds.call("new").args_json(json!({"board": board.id(), "treasury": treasury.id(), "payment_token": ft.id(), "classes": [], "month_ns": 1_000_000_000u64, "exercise_window_ns": 90_000_000_000u64})).transact().await?.into_result()?;
    for a in [board.id(), treasury.id(), ada.id(), zed.id(), investor.id(), rounds.id()] { register(&ft, a).await; }
    for (a, d) in [(&investor, 1_000_000u128), (&zed, 100_000_000)] { ft.call("faucet").args_json(json!({"account_id": a.id(), "amount": (d * USD).to_string()})).transact().await?.into_result()?; }
    board.call(rounds.id(), "set_officer").args_json(json!({"account": ada.id(), "enabled": true})).transact().await?.into_result()?;
    Ok(Env { w, ft, rounds, board, treasury, ada, zed, investor })
}

impl Env {
    async fn propose(&self, root: &Value, proof: &Value, total: &str, raise: Value) -> near_workspaces::result::ExecutionFinalResult {
        self.ada.call(self.rounds.id(), "propose_confidential_round")
            .args_json(json!({"merkle_root": root, "total_shares": total, "raise": raise, "deadline_ns": u64::MAX, "proof": proof})).max_gas().transact().await.unwrap()
    }
    async fn claim(&self, who: &Account, exit: u64, c: &Value, recipient: &str, proof: &Value) -> near_workspaces::result::ExecutionFinalResult {
        who.call(self.rounds.id(), "claim_private_payout")
            .args_json(json!({"exit_id": exit, "nullifier": c["nullifier"], "payout_amount": c["payout"], "recipient_id": recipient, "proof": proof})).max_gas().transact().await.unwrap()
    }
    async fn used(&self, nullifier: &Value) -> bool { self.rounds.view("nullifier_used").args_json(json!({"nullifier": nullifier})).await.unwrap().json().unwrap() }
    async fn ledger(&self) -> u128 { self.rounds.view("ledger_total").await.unwrap().json::<String>().unwrap().parse().unwrap() }
}
fn tamper(p: &Value) -> Value { let mut q = p.clone(); q["a"][0] = json!("1"); q }
fn bump(s: &str) -> String { let mut b = s.as_bytes().to_vec(); let l = b.len() - 1; b[l] = if b[l] == b'9' { b'8' } else { b[l] + 1 }; String::from_utf8(b).unwrap() }
/// The call failed and the failure text mentions `why`.
fn failed(r: &near_workspaces::result::ExecutionFinalResult, why: &str) -> bool { !r.is_success() && format!("{:?}", r).contains(why) }

#[tokio::test]
async fn confidential_round_private_exit_and_claims_to_new_accounts() -> anyhow::Result<()> {
    let e = setup().await?; let f = fx();
    let raise = json!([[e.investor.id(), (1_000 * USD).to_string()]]);
    let root = f["merkle_root"].clone();

    // ---- the round proposal: the cap_table_commit proof is verified on chain before anything is accepted
    assert!(!e.propose(&root, &tamper(&f["commit_proof"]), "1000", raise.clone()).await.is_success(), "tampered proof bytes fail");
    let r999 = e.propose(&root, &f["commit_proof"], "999", raise.clone()).await;
    assert!(failed(&r999, "ERR_INVALID_PROOF"), "a proof for 1000 shares does not prove 999: {:?}", r999);
    assert!(failed(&e.propose(&json!(bump(root.as_str().unwrap())), &f["commit_proof"], "1000", raise.clone()).await, "ERR_INVALID_PROOF"), "a proof for one root does not prove another");
    let r = e.zed.call(e.rounds.id(), "propose_confidential_round").args_json(json!({"merkle_root": root, "total_shares": "1000", "raise": raise, "deadline_ns": u64::MAX, "proof": f["commit_proof"]})).max_gas().transact().await?;
    assert!(failed(&r, "only an officer"), "only an officer proposes");
    let ok = e.propose(&root, &f["commit_proof"], "1000", raise.clone()).await;
    assert!(ok.is_success(), "a valid proof is accepted: {:?}", ok);
    assert_eq!(ok.json::<u64>()?, 1);
    assert!(failed(&e.propose(&root, &f["commit_proof"], "1000", raise.clone()).await, "ERR_INVALID_PROOF"), "the proof is bound to its round id: the same proof cannot open round 2");

    // ---- the DAO approves the plan hash, the investor funds the round, anyone closes it: the root is committed
    let round: Value = e.rounds.view("round").args_json(json!({"round_id": 1})).await?.json()?;
    assert_eq!(round["kind"], "Confidential");
    let (plan, hash) = (round["plan"].as_str().unwrap().to_string(), round["plan_hash"].as_str().unwrap().to_string());
    assert_eq!(h(&plan), hash, "the plan the board approves is exactly what is hashed");
    assert!(plan.contains(root.as_str().unwrap()) && plan.contains("\"total_shares\":\"1000\""), "the plan carries the root and the proven total");
    e.board.call(e.rounds.id(), "approve_round").args_json(json!({"round_id": 1, "plan_hash": hash})).transact().await?.into_result()?;
    e.investor.call(e.ft.id(), "ft_transfer_call").args_json(json!({"receiver_id": e.rounds.id(), "amount": (1_000 * USD).to_string(), "msg": json!({"action": "round", "id": 1}).to_string()})).deposit(ONE).max_gas().transact().await?.into_result()?;
    e.zed.call(e.rounds.id(), "close_round").args_json(json!({"round_id": 1})).gas(Gas::from_tgas(100)).transact().await?.into_result()?;
    let committed: Value = e.rounds.view("confidential_root").args_json(json!({"round_id": 1})).await?.json()?;
    assert_eq!(committed, json!([root, "1000"]), "the closed round stores its root and total");
    assert_eq!(balance(&e.ft, e.treasury.id()).await, 1_000 * USD, "the raise went to the treasury");

    // ---- a private exit: opened by an officer, funded, approved by the board
    let pot: u128 = f["pot"].as_str().unwrap().parse()?;
    assert!(!e.ada.call(e.rounds.id(), "propose_private_exit").args_json(json!({"round_id": 5, "pot": pot.to_string()})).transact().await?.is_success(), "an unknown round has no cap table to pay");
    let x = e.ada.call(e.rounds.id(), "propose_private_exit").args_json(json!({"round_id": 1, "pot": pot.to_string()})).transact().await?.into_result()?.json::<u64>()?;
    assert_eq!(x, 1);
    let burner = account(&e.w, "burner").await; let burner2 = account(&e.w, "burner2").await; let attacker = account(&e.w, "attacker").await;
    for a in [&burner, &burner2, &attacker] { register(&e.ft, a.id()).await; }
    let (c_inv, c_fnd, c_ang) = (&f["claims"]["investor"], &f["claims"]["founder"], &f["claims"]["angel"]);
    assert!(failed(&e.claim(&e.zed, 1, c_inv, "burner.test.near", &c_inv["proof"]).await, "private exit not approved"), "nothing is paid before the board approves");
    e.zed.call(e.ft.id(), "ft_transfer_call").args_json(json!({"receiver_id": e.rounds.id(), "amount": pot.to_string(), "msg": json!({"action": "pexit", "id": 1}).to_string()})).deposit(ONE).max_gas().transact().await?.into_result()?;
    assert!(failed(&e.claim(&e.zed, 1, c_inv, "burner.test.near", &c_inv["proof"]).await, "private exit not approved"), "funded is not approved");
    assert!(!e.zed.call(e.rounds.id(), "approve_private_exit").args_json(json!({"exit_id": 1})).transact().await?.is_success(), "only the board approves");
    e.board.call(e.rounds.id(), "approve_private_exit").args_json(json!({"exit_id": 1})).transact().await?.into_result()?;
    assert_eq!(e.ledger().await, pot, "the funded pot is held by the contract");

    // ---- claims to brand-new accounts, submitted by someone unrelated to the holder
    let r = e.claim(&e.zed, 1, c_inv, "burner.test.near", &c_inv["proof"]).await;
    assert!(r.is_success(), "a valid private claim pays: {:?}", r);
    assert_eq!(balance(&e.ft, burner.id()).await, 6_000 * USD, "600 of 1000 shares of a $10,000 pot");
    assert!(e.used(&c_inv["nullifier"]).await);
    assert_eq!(e.ledger().await, pot - 6_000 * USD);

    // ---- adversarial cases
    assert!(failed(&e.claim(&e.zed, 1, c_inv, "burner.test.near", &c_inv["proof"]).await, "ERR_NULLIFIER_USED"), "replaying a nullifier fails");
    assert!(failed(&e.claim(&e.zed, 1, c_fnd, "attacker.test.near", &c_fnd["proof"]).await, "ERR_INVALID_PROOF"), "front-running a valid proof with another recipient fails");
    assert!(!e.used(&c_fnd["nullifier"]).await, "a rejected claim burns nothing");
    assert!(!e.claim(&e.zed, 1, c_fnd, "burner2.test.near", &tamper(&c_fnd["proof"])).await.is_success(), "invalid proof bytes fail");
    let mut bigger = c_fnd.clone(); bigger["payout"] = json!((3_000 * USD + 1).to_string());
    assert!(failed(&e.claim(&e.zed, 1, &bigger, "burner2.test.near", &c_fnd["proof"]).await, "ERR_INVALID_PROOF"), "claiming more than the exact share fails");
    let mut other = c_fnd.clone(); other["nullifier"] = c_inv["nullifier"].clone();
    assert!(failed(&e.claim(&e.zed, 1, &other, "burner2.test.near", &c_fnd["proof"]).await, "ERR_NULLIFIER_USED"), "a spent nullifier cannot be reused with another proof");
    assert!(failed(&e.claim(&e.zed, 2, c_fnd, "burner2.test.near", &c_fnd["proof"]).await, "no such private exit"));
    assert!(e.claim(&e.zed, 1, c_fnd, "burner2.test.near", &c_fnd["proof"]).await.is_success());
    assert_eq!(balance(&e.ft, burner2.id()).await, 3_000 * USD);

    // ---- the contract registers an unregistered recipient itself: no visible registration transaction from the claimant
    let burner3_id: near_workspaces::AccountId = "burner3.test.near".parse()?;
    // a payout that cannot be delivered (the token is failing transfers) frees its nullifier, then the claim can be retried
    let burner3 = account(&e.w, "burner3").await;
    e.ft.call("set_fail_transfers").args_json(json!({"fail": true})).transact().await?.into_result()?;
    let _ = e.claim(&e.zed, 1, c_ang, "burner3.test.near", &c_ang["proof"]).await;
    assert!(!e.used(&c_ang["nullifier"]).await, "a failed transfer restores the nullifier");
    let ex: Value = e.rounds.view("private_exit").args_json(json!({"exit_id": 1})).await?.json()?;
    assert_eq!(ex["claimed"], (9_000 * USD).to_string(), "and the claimed total");
    e.ft.call("set_fail_transfers").args_json(json!({"fail": false})).transact().await?.into_result()?;
    assert_eq!(e.ft.view("ft_balance_of").args_json(json!({"account_id": burner3_id})).await?.json::<String>()?, "0", "burner3 holds nothing and was never registered by anyone");
    assert!(e.claim(&e.zed, 1, c_ang, "burner3.test.near", &c_ang["proof"]).await.is_success(), "an unregistered recipient is registered by the contract and paid");
    assert_eq!(balance(&e.ft, burner3.id()).await, 1_000 * USD);
    let ex: Value = e.rounds.view("private_exit").args_json(json!({"exit_id": 1})).await?.json()?;
    assert_eq!(ex["claimed"], pot.to_string(), "every holder has been paid exactly their share");
    assert_eq!(e.ledger().await, 0, "the pot is fully paid out");
    assert_eq!(balance(&e.ft, e.rounds.id()).await, 0);
    let _ = &e.board; let _ = &attacker;
    Ok(())
}

/// An optional commitment to an encrypted copy of the private table: part of the plan the board approves.
#[tokio::test]
async fn escrow_hash_is_committed_in_the_plan_the_board_approves() -> anyhow::Result<()> {
    let e = setup().await?; let f = fx();
    let root = f["merkle_root"].clone();
    let with = |hash: Value| e.ada.call(e.rounds.id(), "propose_confidential_round")
        .args_json(json!({"merkle_root": root, "total_shares": "1000", "raise": [], "deadline_ns": u64::MAX, "proof": f["commit_proof"], "escrow_hash": hash})).max_gas().transact();
    assert!(failed(&with(json!("not-a-hash")).await?, "ERR_BAD_ESCROW_HASH"), "a malformed commitment is refused");
    assert!(failed(&with(json!("ABCDEF".repeat(10) + "abcd")).await?, "ERR_BAD_ESCROW_HASH"), "upper case or wrong length is refused");
    let good = "ab".repeat(32);
    let ok = with(json!(good)).await?;
    assert!(ok.is_success(), "{:?}", ok);
    let round: Value = e.rounds.view("round").args_json(json!({"round_id": 1})).await?.json()?;
    let plan = round["plan"].as_str().unwrap();
    assert!(plan.contains(&format!("\"escrow_hash\":\"{}\"", good)), "the commitment is inside the plan: {}", plan);
    assert_eq!(h(plan), round["plan_hash"].as_str().unwrap(), "so the board's approval of the plan hash covers it");
    let _ = (&e.board, &e.treasury, &e.investor, &e.zed);
    Ok(())
}
