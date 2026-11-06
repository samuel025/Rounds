use near_workspaces::{network::Sandbox, types::{Gas, NearToken}, Account, Contract, Worker};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const ROUNDS_WASM: &str = "../target/near/rounds.wasm";
const FT_WASM: &str = "../mock-ft/target/near/mock_ft.wasm";
const ONE: NearToken = NearToken::from_yoctonear(1);
const USD: u128 = 1_000_000; // micro-dollars per dollar = token units

fn h(s: &str) -> String { Sha256::digest(s.as_bytes()).iter().map(|b| format!("{:02x}", b)).collect() }

struct Env {
    w: Worker<Sandbox>, ft: Contract, rounds: Contract,
    board: Account, ada: Account, bayo: Account, chidi: Account, dayo: Account, fund: Account, efe: Account, zed: Account,
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
    let (board, ada, bayo, chidi, dayo, fund, efe, zed) = (mk("board").await, mk("ada").await, mk("bayo").await, mk("chidi").await, mk("dayo").await, mk("fund").await, mk("efe").await, mk("zed").await);
    let ft = w.dev_deploy(&std::fs::read(FT_WASM)?).await?;
    ft.call("new").args_json(json!({"faucet_cap": (100_000_000u128 * USD).to_string()})).transact().await?.into_result()?;
    let rounds = w.dev_deploy(&std::fs::read(ROUNDS_WASM)?).await?;
    let classes: Vec<Value> = ["Common", "SeriesA", "safe1", "safe2"].iter().map(|c| json!({"id": c, "authorized": "100000000"})).collect();
    rounds.call("new").args_json(json!({"board": board.id(), "payment_token": ft.id(), "classes": classes,
        "month_ns": 1_000_000_000u64, "exercise_window_ns": 90_000_000_000u64})).transact().await?.into_result()?;
    register(&ft, &[board.id(), ada.id(), bayo.id(), chidi.id(), dayo.id(), fund.id(), efe.id(), zed.id(), rounds.id()]).await;
    for (a, d) in [(&chidi, 1_000_000u128), (&dayo, 1_000_000), (&fund, 20_000_000), (&zed, 100_000_000), (&efe, 1_000_000)] { faucet(&ft, a, d).await; }
    board.call(rounds.id(), "set_officer").args_json(json!({"account": ada.id(), "enabled": true})).transact().await?.into_result()?;
    Ok(Env { w, ft, rounds, board, ada, bayo, chidi, dayo, fund, efe, zed })
}

impl Env {
    async fn propose(&self, kind: &str, plan: &str, raise: Value) -> u64 {
        self.ada.call(self.rounds.id(), "propose_round").args_json(json!({"kind": kind, "plan_hash": h(plan), "plan_uri": "ipfs://demo", "plan": plan, "raise": raise, "deadline_ns": u64::MAX}))
            .transact().await.unwrap().into_result().unwrap().json::<u64>().unwrap()
    }
    async fn deposit(&self, who: &Account, round: u64, usd: u128) {
        who.call(self.ft.id(), "ft_transfer_call").args_json(json!({"receiver_id": self.rounds.id(), "amount": (usd * USD).to_string(), "msg": json!({"action": "round", "id": round}).to_string()}))
            .deposit(ONE).max_gas().transact().await.unwrap().into_result().unwrap();
    }
    async fn approve(&self, round: u64, plan: &str) -> bool {
        self.board.call(self.rounds.id(), "approve_round").args_json(json!({"round_id": round, "plan_hash": h(plan)})).transact().await.unwrap().is_success()
    }
    async fn close(&self, round: u64) -> bool {
        self.efe.call(self.rounds.id(), "close_round").args_json(json!({"round_id": round})).gas(Gas::from_tgas(100)).transact().await.unwrap().is_success()
    }
    async fn holding(&self, holder: &str, class: &str) -> u128 {
        let v: Vec<(String, String)> = self.rounds.view("holdings_of").args_json(json!({"holder": holder})).await.unwrap().json().unwrap();
        v.into_iter().find(|(c, _)| c == class).map(|(_, s)| s.parse().unwrap()).unwrap_or(0)
    }
    async fn status(&self, round: u64) -> String {
        self.rounds.view("round").args_json(json!({"round_id": round})).await.unwrap().json::<Value>().unwrap()["status"].as_str().unwrap().to_string()
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
    assert_eq!(balance(&e.ft, e.board.id()).await, 750_000 * USD, "escrow forwarded to the treasury");
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
    assert!(!e.fund.call(e.rounds.id(), "approve_round").args_json(json!({"round_id": r, "plan_hash": h(FOUNDER)})).transact().await?.is_success(), "non-board approve fails");
    assert!(!e.board.call(e.rounds.id(), "approve_round").args_json(json!({"round_id": r, "plan_hash": h("other")})).transact().await?.is_success(), "hash mismatch fails");
    assert!(!e.fund.call(e.rounds.id(), "propose_round").args_json(json!({"kind":"Founder","plan_hash":h(FOUNDER),"plan_uri":"x","plan":FOUNDER,"raise":[],"deadline_ns":u64::MAX})).transact().await?.is_success(), "non-officer propose fails");
    assert!(!e.ada.call(e.rounds.id(), "propose_round").args_json(json!({"kind":"Founder","plan_hash":h("x"),"plan_uri":"x","plan":FOUNDER,"raise":[],"deadline_ns":u64::MAX})).transact().await?.is_success(), "proposed plan must match its hash");
    // cannot close before approval
    assert!(!e.close(r).await);
    assert!(e.approve(r, FOUNDER).await);
    assert!(!e.approve(r, FOUNDER).await, "approve cannot repeat");
    assert!(e.close(r).await);
    // double close does nothing
    assert!(!e.close(r).await);
    assert_eq!(e.holding("ada", "Common").await, 5_000_000);
    // outsiders cannot call callbacks
    for (m, a) in [("on_close", json!({"round_id": r, "total": "0"})), ("on_payout", json!({"exit_id": 1, "index": 0})), ("on_refund", json!({"round_id": r, "investor": e.ada.id(), "amount": "1"}))] {
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
    e.zed.call(e.rounds.id(), "distribute").args_json(json!({"exit_id": x, "from": 0, "limit": 2})).max_gas().transact().await?;
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
    Ok(())
}
