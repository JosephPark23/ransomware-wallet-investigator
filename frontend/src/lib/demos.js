/**
 * Curated demo addresses.
 *
 * The backend serves these from GET /api/demo, sourced from
 * `backend/data/demo_addresses.json`. App.jsx fetches that on mount and falls
 * back to the list below when the endpoint is unreachable or returns nothing,
 * so the picker always has something in it.
 *
 * The fallback list mirrors the backend's curated set, and every address in it
 * has a committed chain fixture -- so the demo works with OFFLINE_MODE=1 and no
 * network at all. That is the whole point of a fallback: it has to work in the
 * situation that caused it to be used.
 *
 * The previous entry here was `1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa` labelled
 * "Conti (ransomware)". That address is the Bitcoin genesis block coinbase. It
 * appears in neither the OFAC list nor the Ransomwhere dataset, so it produces
 * no list signals at all, and the backend's own calibration file lists it as a
 * BENIGN control. Opening the demo on an address labelled as ransomware that
 * scores clean is the kind of detail a reviewer notices first.
 */

export const DEMO_ADDRESSES = [
  {
    id: 'ofac',
    address: '123WBUDmSJv4GctdVEz6Qq6z8nXSKrJ4KX',
    label: 'OFAC-designated',
  },
  {
    id: 'collector',
    address: '1Pem6rKEegySJBkgXMCEqt4Z7i67smd5GP',
    label: 'Collection wallet',
  },
  {
    id: 'forwarder',
    address: '1ForwarderTestAddressAAAAAAAAAAAAAA',
    label: 'Pass-through relay',
  },
  {
    id: 'peeler',
    address: '1H58yfjY9skCz2qYT3NaANvYk5A2x2mn4H',
    label: 'Self-peeling wallet',
  },
  {
    id: 'counterparty',
    address: '1NeighbourTestAddressAAAAAAAAAAAAAA',
    label: 'One hop from a sanctioned address',
  },
  {
    id: 'benign',
    address: '1zG91z5ZxWVF3BM9HCWmMafhjj4DFbMQjz',
    label: 'Clean control',
  },
];

/**
 * Normalise one /api/demo record into what DemoPicker renders.
 * Returns null for anything without a usable address, so a partial backend
 * response contributes its good rows instead of breaking the picker.
 */
export function toDemoEntry(record, index = 0) {
  const address = typeof record?.address === 'string' ? record.address.trim() : '';
  if (!address) return null;
  const label = typeof record?.label === 'string' && record.label.trim() ? record.label.trim() : address;
  return {
    id: record?.category ? `${record.category}-${index}` : `demo-${index}`,
    address,
    label,
    expectation: typeof record?.expectation === 'string' ? record.expectation : undefined,
  };
}

/** Map a /api/demo payload to demo entries, falling back when it yields none. */
export function demoAddressesFrom(payload) {
  const entries = (Array.isArray(payload) ? payload : []).map(toDemoEntry).filter(Boolean);
  return entries.length > 0 ? entries : DEMO_ADDRESSES;
}
