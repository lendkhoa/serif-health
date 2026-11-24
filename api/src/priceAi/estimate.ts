import type { Plan } from './schema'

/** What the member still has to pay before each threshold. */
export type Balances = { deductible: number; out_of_pocket: number }

export type Estimate = { member_pays: number; plan_pays: number; after: Balances }

const cents = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

export const startingBalances = (plan: Plan): Balances => ({
  deductible: cents(plan.deductible.total - plan.deductible.met),
  out_of_pocket: cents(plan.out_of_pocket_max.total - plan.out_of_pocket_max.met),
})

/**
 * In-network cost of one procedure. A copay replaces the deductible and coinsurance, and does not
 * count toward the deductible; real plans vary. Nothing is owed past the out-of-pocket maximum.
 */
export function estimate(rate: number, copay: number | null, coinsurance: number, left: Balances): Estimate {
  const toDeductible = copay === null ? Math.min(rate, left.deductible) : 0
  const owed = copay === null ? toDeductible + coinsurance * (rate - toDeductible) : Math.min(copay, rate)
  const member = cents(Math.min(owed, left.out_of_pocket))
  return {
    member_pays: member,
    plan_pays: cents(rate - member),
    after: {
      deductible: cents(left.deductible - Math.min(toDeductible, member)),
      out_of_pocket: cents(left.out_of_pocket - member),
    },
  }
}
