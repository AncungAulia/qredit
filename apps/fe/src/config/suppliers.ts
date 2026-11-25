/**
 * Public names of the simulated suppliers, by address. The chain only knows addresses; these are the
 * suppliers of the testnet deployment (engine/suppliers.json). An address not listed here shows as an address.
 */
export const SUPPLIER_NAMES: Record<string, string> = {
  "0x56a70547aef31e40614abe7eb0e25e304b1c622f": "Data indexer",
  "0xcc8eef910e741eb33effc104121e79c43cb3488e": "List oracle",
  "0x86387b71320aa28b2aa37fd5ba0e95d612508cee": "Basic compute",
  "0xabfd730e9c4a82badb63794432108e97bd88f5fa": "Deep compute",
};
