import type { ApprovalChoice } from './gateway-contract.generated'

// Wire shapes of the fork.approvals.* methods the hermes-approvals plugin registers
// at runtime (plugin methods are not part of the generated gateway contract).
export type ForkApprovalStatus = 'pending' | 'allowed' | 'denied' | 'expired' | 'withdrawn'

export interface ForkApproval {
  request_id: string
  tool_call_id: string
  tool_name: string
  command: string
  description: string
  created_at: number
  status: ForkApprovalStatus
  decided_at?: number | null
  choice?: ApprovalChoice | null
  ran_at?: number | null
  reason?: string | null
}

export interface ForkApprovalsListResult {
  approvals: ForkApproval[]
}

export interface ForkApprovalsDecideResult {
  approval: ForkApproval
  resolved: boolean
}
