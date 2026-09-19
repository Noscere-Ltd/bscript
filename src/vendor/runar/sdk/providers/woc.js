// ---------------------------------------------------------------------------
// runar-sdk/providers/woc.ts — WhatsOnChain provider (HTTP-based BSV API)
// ---------------------------------------------------------------------------
import { InputLimits } from '../../ir-schema/input-limits.js';
import { assertScriptHexUnderLimit } from '../errors.js';
// ---------------------------------------------------------------------------
// Provider implementation
// ---------------------------------------------------------------------------
export class WhatsOnChainProvider {
    baseUrl;
    network;
    constructor(network = 'mainnet') {
        this.network = network;
        this.baseUrl =
            network === 'mainnet'
                ? 'https://api.whatsonchain.com/v1/bsv/main'
                : 'https://api.whatsonchain.com/v1/bsv/test';
    }
    async getTransaction(txid) {
        const resp = await fetch(`${this.baseUrl}/tx/hash/${txid}`);
        if (!resp.ok) {
            throw new Error(`WoC getTransaction failed (${resp.status}): ${await resp.text()}`);
        }
        const data = (await resp.json());
        const inputs = data.vin.map((vin) => ({
            txid: vin.txid,
            outputIndex: vin.vout,
            script: vin.scriptSig.hex,
            sequence: vin.sequence,
        }));
        const outputs = data.vout.map((vout) => ({
            satoshis: Math.round(vout.value * 1e8),
            script: vout.scriptPubKey.hex,
        }));
        return {
            txid: data.txid,
            version: data.version,
            inputs,
            outputs,
            locktime: data.locktime,
            raw: data.hex,
        };
    }
    async broadcast(tx) {
        const rawTx = tx.toHex();
        const resp = await fetch(`${this.baseUrl}/tx/raw`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ txhex: rawTx }),
        });
        if (!resp.ok) {
            throw new Error(`WoC broadcast failed (${resp.status}): ${await resp.text()}`);
        }
        // WoC returns the txid as a plain string (JSON-encoded)
        const txid = (await resp.json());
        return txid;
    }
    async getUtxos(address) {
        const resp = await fetch(`${this.baseUrl}/address/${address}/unspent`);
        if (!resp.ok) {
            throw new Error(`WoC getUtxos failed (${resp.status}): ${await resp.text()}`);
        }
        const entries = (await resp.json());
        // WoC doesn't return the locking script in the UTXO list, so we set it
        // to empty and callers can look it up if needed.
        const utxos = entries.map((e) => ({
            txid: e.tx_hash,
            outputIndex: e.tx_pos,
            satoshis: e.value,
            script: '',
        }));
        // DoS-bound: defensive guard — WoC currently returns empty scripts but a
        // future enriched response must not bypass MAX_SCRIPT_BYTES.
        for (const u of utxos) {
            if (u.script) {
                assertScriptHexUnderLimit(u.script, InputLimits.MAX_SCRIPT_BYTES, `WhatsOnChainProvider.getUtxos(${address})`);
            }
        }
        return utxos;
    }
    async getContractUtxo(scriptHash) {
        const resp = await fetch(`${this.baseUrl}/script/${scriptHash}/unspent`);
        if (!resp.ok) {
            // 404 simply means no UTXO found
            if (resp.status === 404)
                return null;
            throw new Error(`WoC getContractUtxo failed (${resp.status}): ${await resp.text()}`);
        }
        const entries = (await resp.json());
        if (entries.length === 0)
            return null;
        // Return the first (latest) unspent entry
        const first = entries[0];
        const utxo = {
            txid: first.tx_hash,
            outputIndex: first.tx_pos,
            satoshis: first.value,
            script: '',
        };
        if (utxo.script) {
            assertScriptHexUnderLimit(utxo.script, InputLimits.MAX_SCRIPT_BYTES, `WhatsOnChainProvider.getContractUtxo(${scriptHash})`);
        }
        return utxo;
    }
    getNetwork() {
        return this.network;
    }
    async getRawTransaction(txid) {
        const resp = await fetch(`${this.baseUrl}/tx/${txid}/hex`);
        if (!resp.ok) {
            throw new Error(`WoC getRawTransaction failed (${resp.status}): ${await resp.text()}`);
        }
        return (await resp.text()).trim();
    }
    async getFeeRate() {
        // BSV standard relay fee is 0.1 sat/byte (100 sat/KB).
        return 100;
    }
}
//# sourceMappingURL=woc.js.map