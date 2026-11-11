pragma circom 2.0.0;

// Confidential cap table commitment (Rounds, optional confidential mode).
// Proves, without revealing any holding, that a private cap table of up to 2^DEPTH slots
//   - has every share amount in [0, 2^64) (no field-overflow tricks),
//   - sums to the public total_shares,
//   - hashes to the public Poseidon Merkle root.
// Leaf = Poseidon(holder_secret_hash, share_class, share_amount, salt); node = Poseidon(left, right).
// An unused slot is the leaf of four zeros, Poseidon(0, 0, 0, 0). round_id is public so a proof is bound to one round.
include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/bitify.circom";

template CapTableCommit(DEPTH) {
    var N = 1 << DEPTH;

    signal input holder_secret_hashes[N];
    signal input share_classes[N];
    signal input share_amounts[N];
    signal input salts[N];
    signal input merkle_root;
    signal input total_shares;
    signal input round_id;

    // 1. amounts are 64-bit numbers, and they add up to the public total
    component range[N];
    var sum = 0;
    for (var i = 0; i < N; i++) {
        range[i] = Num2Bits(64);
        range[i].in <== share_amounts[i];
        sum += share_amounts[i];
    }
    sum === total_shares;

    // 2. leaves
    component leaf[N];
    signal nodes[2 * N - 1];
    for (var i = 0; i < N; i++) {
        leaf[i] = Poseidon(4);
        leaf[i].inputs[0] <== holder_secret_hashes[i];
        leaf[i].inputs[1] <== share_classes[i];
        leaf[i].inputs[2] <== share_amounts[i];
        leaf[i].inputs[3] <== salts[i];
        nodes[i] <== leaf[i].out;
    }

    // 3. the tree: nodes[N + j] = Poseidon(nodes[2j], nodes[2j + 1]); the root is the last node
    component hash[N - 1];
    for (var j = 0; j < N - 1; j++) {
        hash[j] = Poseidon(2);
        hash[j].inputs[0] <== nodes[2 * j];
        hash[j].inputs[1] <== nodes[2 * j + 1];
        nodes[N + j] <== hash[j].out;
    }
    merkle_root === nodes[2 * N - 2];

    // 4. make round_id part of the constraint system, so a proof cannot be reused for another round
    signal round_sq;
    round_sq <== round_id * round_id;
}

component main { public [merkle_root, total_shares, round_id] } = CapTableCommit(6);
