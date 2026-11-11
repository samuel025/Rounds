pragma circom 2.0.0;

// Private payout claim (Rounds, optional confidential mode).
// A shareholder proves, without saying which leaf is theirs, that
//   - their leaf is in the committed Poseidon Merkle tree,
//   - the public nullifier is Poseidon(holder_secret, exit_id) (one claim per leaf per exit),
//   - payout_amount = floor(share_amount * total_pot / total_shares), exactly,
// and the proof is bound to recipient_hash, so it cannot be redirected to another account.
include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/comparators.circom";

template PrivateClaim(DEPTH) {
    signal input holder_secret;
    signal input share_class;
    signal input share_amount;
    signal input salt;
    signal input path_elements[DEPTH];
    signal input path_indices[DEPTH];

    signal input merkle_root;
    signal input nullifier;
    signal input exit_id;
    signal input total_shares;
    signal input total_pot;
    signal input payout_amount;
    signal input recipient_hash;

    // leaf
    component secretHash = Poseidon(1);
    secretHash.inputs[0] <== holder_secret;
    component leaf = Poseidon(4);
    leaf.inputs[0] <== secretHash.out;
    leaf.inputs[1] <== share_class;
    leaf.inputs[2] <== share_amount;
    leaf.inputs[3] <== salt;

    // Merkle inclusion; path_indices[i] = 1 means the sibling is on the left
    component hasher[DEPTH];
    signal cur[DEPTH + 1];
    signal swap[DEPTH];
    signal left[DEPTH];
    signal right[DEPTH];
    cur[0] <== leaf.out;
    for (var i = 0; i < DEPTH; i++) {
        path_indices[i] * (path_indices[i] - 1) === 0;
        swap[i] <== path_indices[i] * (path_elements[i] - cur[i]);
        left[i] <== cur[i] + swap[i];
        right[i] <== path_elements[i] - swap[i];
        hasher[i] = Poseidon(2);
        hasher[i].inputs[0] <== left[i];
        hasher[i].inputs[1] <== right[i];
        cur[i + 1] <== hasher[i].out;
    }
    cur[DEPTH] === merkle_root;

    // nullifier
    component nf = Poseidon(2);
    nf.inputs[0] <== holder_secret;
    nf.inputs[1] <== exit_id;
    nf.out === nullifier;

    // 64-bit ranges, so the products below cannot wrap around the field
    component rShare = Num2Bits(64); rShare.in <== share_amount;
    component rPot = Num2Bits(64); rPot.in <== total_pot;
    component rPay = Num2Bits(64); rPay.in <== payout_amount;
    component rTotal = Num2Bits(64); rTotal.in <== total_shares;
    component noTotal = IsZero(); noTotal.in <== total_shares;
    noTotal.out === 0;

    // exact floor division: payout * total <= share * pot < (payout + 1) * total
    signal lhs;
    signal lhs1;
    signal rhs;
    lhs <== payout_amount * total_shares;
    lhs1 <== (payout_amount + 1) * total_shares;
    rhs <== share_amount * total_pot;
    component le = LessEqThan(130);
    le.in[0] <== lhs;
    le.in[1] <== rhs;
    le.out === 1;
    component lt = LessThan(130);
    lt.in[0] <== rhs;
    lt.in[1] <== lhs1;
    lt.out === 1;

    // make recipient_hash part of the constraint system
    signal recipient_sq;
    recipient_sq <== recipient_hash * recipient_hash;
}

component main { public [merkle_root, nullifier, exit_id, total_shares, total_pot, payout_amount, recipient_hash] } = PrivateClaim(6);
