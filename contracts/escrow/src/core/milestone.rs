// Derived from Trustless-Work/trustlesswork-smart-contract-stellar@1d22d0c (contracts/escrow/src/core/milestone.rs), modified. See contracts/escrow/NOTICE.md
// FIANZAS: de `approve_milestones_inner` se conserva el quórum (`approved_by.push_back`,
// `approval_count = len`, rechazo de duplicados) sobre una sola aprobación, sin milestones.
// `approve_release` liquida al llegar al quórum (semántica de `approve_and_release_milestones`).
// Se elimina `change_milestone_status`.
use soroban_sdk::{Address, Env};

use crate::core::settle::settle;
use crate::core::EscrowManager;
use crate::error::EscrowError;
use crate::events::handler::FzApprove;
use crate::storage::types::{Escrow, SettlePath, Settlement, Status};

pub struct MilestoneManager;

impl MilestoneManager {
    pub fn approve_release(
        e: &Env,
        approver: &Address,
    ) -> Result<(Escrow, Option<Settlement>), EscrowError> {
        approver.require_auth();
        let mut escrow = EscrowManager::get_escrow(e)?;
        let is_party =
            *approver == escrow.terms.landlord || escrow.tenant.as_ref() == Some(approver);
        if !is_party {
            return Err(EscrowError::NotParty);
        }
        // Estado almacenado: vale antes y después de end_ts.
        if escrow.status != Status::Active {
            return Err(EscrowError::BadStatus);
        }
        if escrow.approvals.approved_by.contains(approver) {
            return Err(EscrowError::AlreadyApproved);
        }
        escrow.approvals.approved_by.push_back(approver.clone());
        escrow.approvals.approval_count = escrow.approvals.approved_by.len();
        EscrowManager::save(e, &escrow);
        FzApprove {
            id: escrow.terms.id,
            approver: approver.clone(),
            approval_count: escrow.approvals.approval_count,
        }
        .publish(e);

        if escrow.approvals.approval_count < escrow.approvals.target {
            return Ok((escrow, None));
        }
        let settlement = settle(e, &mut escrow, 0, SettlePath::Approved)?;
        Ok((escrow, Some(settlement)))
    }
}
