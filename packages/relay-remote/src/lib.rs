//! The broker (one small process per conversation that holds the agent's pipes) and Relay's link to a work machine:
//! a `relay-server` on another computer in the LAN that runs the agents, reached over mutual TLS with pinned
//! certificates (tls), speaking JSON lines (proto) before the broker's own frames.

pub mod broker;
pub mod client;
pub mod proto;
pub mod sync;
pub mod tls;
