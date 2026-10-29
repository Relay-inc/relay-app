//! The broker (one small process per conversation that holds the agent's pipes) and Relay's link to a work machine:
//! a `relay-server` on another computer in the LAN that runs the agents, reached over mutual TLS with pinned
//! certificates (tls), speaking JSON lines (proto) before the broker's own frames. Also the client side of vaults
//! shared through such a server, sealed with a key only the members hold (vault).

pub mod broker;
pub mod channel;
pub mod client;
pub mod docs;
pub mod members;
pub mod proto;
pub mod share;
pub mod sync;
pub mod tls;
pub mod vault;
