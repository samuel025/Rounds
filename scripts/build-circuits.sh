#!/usr/bin/env bash
# make circuits: compiles the two circom circuits, runs a LOCAL Powers of Tau and Groth16 setup, and exports the artifacts.
# DEV / DEMO SETUP ONLY: the ceremony below has a single contributor (this machine). Anyone who knew that contribution's randomness
# ("toxic waste") could forge proofs. It is fine for testnet play money and is disclosed in the README; a real deployment needs a
# multi-party ceremony.
set -euo pipefail
cd "$(dirname "$0")/../circuits"
[ -d node_modules ] || npm install --no-audit --no-fund
mkdir -p build ptau ../web/public/zk ../contract/src/zk
rand() { node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"; }
# 2^16 powers cover the larger circuit (38,225 constraints with --O2)
if [ ! -f ptau/pot16_final.ptau ]; then
  npx snarkjs powersoftau new bn128 16 ptau/pot16_0000.ptau
  npx snarkjs powersoftau contribute ptau/pot16_0000.ptau ptau/pot16_0001.ptau --name="rounds dev contribution" -e="$(rand)"
  npx snarkjs powersoftau prepare phase2 ptau/pot16_0001.ptau ptau/pot16_final.ptau
fi
for c in cap_table_commit private_claim; do
  circom "$c.circom" --r1cs --wasm --sym --O2 -o build -l node_modules
  npx snarkjs groth16 setup "build/$c.r1cs" ptau/pot16_final.ptau "build/${c}_0000.zkey"
  npx snarkjs zkey contribute "build/${c}_0000.zkey" "build/${c}_final.zkey" --name="rounds dev $c" -e="$(rand)"
  npx snarkjs zkey export verificationkey "build/${c}_final.zkey" "build/${c}_verification_key.json"
  cp "build/${c}_js/$c.wasm" "../web/public/zk/$c.wasm"
  cp "build/${c}_final.zkey" "../web/public/zk/${c}_final.zkey"
  cp "build/${c}_verification_key.json" "../web/public/zk/${c}_verification_key.json"
  cp "build/${c}_verification_key.json" "../contract/src/zk/${c}_verification_key.json"
done
(cd .. && node scripts/vk-to-rust.mjs)
echo "circuits built: web/public/zk/*.wasm, *_final.zkey, *_verification_key.json and contract/src/zk/*"
