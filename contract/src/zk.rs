//! Groth16 verification over BN254 using NEAR's alt_bn128 host functions, for Rounds' optional confidential mode.
//! Two circuits (circuits/*.circom) have embedded verification keys: `cap_table_commit` (a private cap table sums to a public total and
//! hashes to a public Poseidon root) and `private_claim` (a holder proves membership and an exact pro-rata payout for one recipient).
//! DEV / DEMO trusted setup: the keys come from a single-contributor ceremony (see the README); never use them for real value.
use near_sdk::{env, near, require};

pub mod vk_cap_table;
pub mod vk_claim;

/// The BN254 scalar field modulus r, little-endian limbs.
const R: [u64; 4] = [0x43e1f593f0000001, 0x2833e84879b97091, 0xb85045b68181585d, 0x30644e72e131a029];

/// A snarkjs Groth16 proof with its coordinates as decimal strings: `a` and `c` are G1 points, `b` a G2 point in snarkjs's [c0, c1] order.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct Groth16Proof { pub a: [String; 2], pub b: [[String; 2]; 2], pub c: [String; 2] }

pub struct VerifyingKey { alpha: &'static [u8; 64], beta: &'static [u8; 128], gamma: &'static [u8; 128], delta: &'static [u8; 128], ic: &'static [[u8; 64]] }
pub fn cap_table_key() -> VerifyingKey { use vk_cap_table as k; VerifyingKey { alpha: &k::ALPHA_G1, beta: &k::BETA_G2, gamma: &k::GAMMA_G2, delta: &k::DELTA_G2, ic: &k::IC } }
pub fn claim_key() -> VerifyingKey { use vk_claim as k; VerifyingKey { alpha: &k::ALPHA_G1, beta: &k::BETA_G2, gamma: &k::GAMMA_G2, delta: &k::DELTA_G2, ic: &k::IC } }

fn ge(a: &[u64; 4], b: &[u64; 4]) -> bool { for i in (0..4).rev() { if a[i] != b[i] { return a[i] > b[i]; } } true }
fn sub(a: &mut [u64; 4], b: &[u64; 4]) { let mut borrow = 0u128; for i in 0..4 { let t = (a[i] as u128).wrapping_sub(b[i] as u128).wrapping_sub(borrow); a[i] = t as u64; borrow = (t >> 127) & 1; } }
fn to_le_bytes(l: &[u64; 4]) -> [u8; 32] { let mut o = [0u8; 32]; for i in 0..4 { o[i * 8..i * 8 + 8].copy_from_slice(&l[i].to_le_bytes()); } o }

/// A decimal string as little-endian limbs; panics if it is not a number below 2^256.
fn parse_dec(s: &str) -> [u64; 4] {
    require!(!s.is_empty() && s.len() <= 78 && s.bytes().all(|c| c.is_ascii_digit()), "ERR_BAD_FIELD_ELEMENT");
    let mut l = [0u64; 4];
    for c in s.bytes() {
        let mut carry = (c - b'0') as u128;
        for limb in l.iter_mut() { let v = (*limb as u128) * 10 + carry; *limb = v as u64; carry = v >> 64; }
        require!(carry == 0, "ERR_BAD_FIELD_ELEMENT");
    }
    l
}
/// A public input or scalar: a decimal string that must be strictly below the scalar field modulus.
pub fn field_element(s: &str) -> [u8; 32] {
    let l = parse_dec(s);
    require!(!ge(&l, &R), "ERR_PUBLIC_INPUT_NOT_IN_FIELD");
    to_le_bytes(&l)
}
pub fn field_from_u128(v: u128) -> [u8; 32] { let mut o = [0u8; 32]; o[..16].copy_from_slice(&v.to_le_bytes()); o }
pub fn field_from_u64(v: u64) -> [u8; 32] { field_from_u128(v as u128) }
/// sha256(account id) read as a big-endian number and reduced modulo r: the `recipient_hash` public input of the claim circuit.
pub fn recipient_hash(account_id: &str) -> [u8; 32] {
    let h = env::sha256(account_id.as_bytes());
    let mut l = [0u64; 4];
    for i in 0..4 { let mut limb = [0u8; 8]; limb.copy_from_slice(&h[24 - i * 8..32 - i * 8]); l[i] = u64::from_be_bytes(limb); }
    while ge(&l, &R) { sub(&mut l, &R); }
    to_le_bytes(&l)
}
/// A base-field coordinate: any 254-bit decimal is accepted here, the host functions reject points that are not on the curve.
fn coord(s: &str) -> [u8; 32] { to_le_bytes(&parse_dec(s)) }
fn g1(p: &[String; 2]) -> Vec<u8> { let mut v = coord(&p[0]).to_vec(); v.extend_from_slice(&coord(&p[1])); v }
fn g2(p: &[[String; 2]; 2]) -> Vec<u8> { let mut v = Vec::with_capacity(128); for c in [&p[0][0], &p[0][1], &p[1][0], &p[1][1]] { v.extend_from_slice(&coord(c)); } v }

/// e(-A, B) * e(alpha, beta) * e(vk_x, gamma) * e(C, delta) == 1, with vk_x = IC[0] + sum(public_i * IC[i + 1]).
/// `public` holds the public inputs in the circuit's declared order, each already a canonical little-endian field element.
pub fn verify(vk: &VerifyingKey, proof: &Groth16Proof, public: &[[u8; 32]]) -> bool {
    require!(public.len() + 1 == vk.ic.len(), "ERR_WRONG_PUBLIC_INPUT_COUNT");
    let a = g1(&proof.a);
    let mut msm = Vec::with_capacity(public.len() * 96);
    for (i, p) in public.iter().enumerate() { msm.extend_from_slice(&vk.ic[i + 1]); msm.extend_from_slice(p); }
    let acc = env::alt_bn128_g1_multiexp(&msm);
    let mut sum = Vec::with_capacity(130);
    sum.push(0u8); sum.extend_from_slice(&vk.ic[0]); sum.push(0u8); sum.extend_from_slice(&acc);
    let vk_x = env::alt_bn128_g1_sum(&sum);
    let mut neg = Vec::with_capacity(65);
    neg.push(1u8); neg.extend_from_slice(&a);
    let neg_a = env::alt_bn128_g1_sum(&neg);
    let mut pairs = Vec::with_capacity(4 * 192);
    pairs.extend_from_slice(&neg_a); pairs.extend_from_slice(&g2(&proof.b));
    pairs.extend_from_slice(vk.alpha); pairs.extend_from_slice(vk.beta);
    pairs.extend_from_slice(&vk_x); pairs.extend_from_slice(vk.gamma);
    pairs.extend_from_slice(&g1(&proof.c)); pairs.extend_from_slice(vk.delta);
    env::alt_bn128_pairing_check(&pairs)
}
