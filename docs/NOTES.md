# NOTES
- 2026-11-06: Spec read from the Claude Doc "Rounds: Cap Table and Fundraising on NEAR (Build Spec)". Section 15 docs not yet read (need web). Toolchain: node 23.11, python 3.12, rustc/cargo 1.99.1, make 4.3. pnpm absent (using npm).
- GV-1 and GV-2 re-checked by hand: Cap_pre=10,000,000, price $2.00, FD 15,000,000; GV-2 rows at $12M/$20M/$60M agree.
- 2026-11-06 (M1 docs pass, partial): 
  - Sputnik README (github near-daos/sputnik-dao-contract): default policy = roles all(AddProposal) + council group (Finalize/AddProposal/VoteApprove/VoteReject/VoteRemove); default_vote_policy RoleWeight, quorum 0, threshold [1,2] (ratio = 50% of role members, NOT strict majority — for 3 members, [1,2] needs 2 votes; confirm rounding); proposal_bond 1 NEAR; proposal_period 7 days. README does NOT show FunctionCall JSON or whether the DAO is predecessor (open Q2) — verify in spike. Factory looks like `sputnik-v2.testnet` (unconfirmed, open Q3).
  - NEAR security checklist confirmed: #[private] callbacks handling success+failure; credit only after callback success; ft_on_transfer must check predecessor and return unused; reentrancy-safe state at every receipt; test low-gas.
  - YC SAFE: ycombinator.com/documents only links a .docx; the definitions (Company Capitalization etc.) are NOT yet read. RULES.md citations remain TODO.
