// Derived from Trustless-Work/trustlesswork-smart-contract-stellar@1d22d0c (contracts/escrow/src/tests/mod.rs), modified. See contracts/escrow/NOTICE.md
// FIANZAS: los tests del upstream (milestones, update_escrow, reparto libre) ya no aplican y
// se sustituyen por los nuestros. Se conserva el estilo de helpers.rs.
mod fake_factory;
mod helpers;

mod cancel;
mod constructor;
mod fund;
