import { useMemo, useSyncExternalStore } from 'react'
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query'
import type { AuthClient } from '../core/client.js'
import type { MfaState, MfaStepUpInput, MfaVerifyInput, TokenResponse } from '../core/types.js'
import { useAuthClient } from './useAuthClient.js'
import { ME_QUERY_KEY } from './context.js'

const IDLE: MfaState = { stage: 'idle', mfaToken: null, methods: [], enrollmentUrl: null }

export function useMfaState(client: AuthClient): MfaState {
  return useSyncExternalStore(
    (callback) => client.on('mfa-state-changed', callback),
    () => client.getMfaState(),
    () => IDLE, // SSR
  )
}

type CallableMutation<TData, TVariables> = UseMutationResult<TData, Error, TVariables> &
  ((variables: TVariables) => Promise<TData>)

function makeCallable<TData, TVariables>(
  mutation: UseMutationResult<TData, Error, TVariables>,
): CallableMutation<TData, TVariables> {
  const fn = ((variables: TVariables) => mutation.mutateAsync(variables)) as CallableMutation<
    TData,
    TVariables
  >
  return Object.assign(fn, mutation)
}

// mfaToken opcjonalny — domyślnie bierzemy go ze stanu (po MfaRequiredError z login()).
export type UseMfaVerifyInput = Omit<MfaVerifyInput, 'mfaToken'> & { mfaToken?: string }

// 2FA w React. Stan (`stage`) pochodzi z klienta, więc integruje się z `useAuth().login`:
//   login() rzuca MfaRequiredError → stage 'code' → pokaż pole kodu → verify({ code }).
//   403 mfa_step_up z dowolnego requestu → stage 'step-up' → modal → stepUp({ code }).
//   403 mfa_enrollment_required → stage 'enrollment' (bez URL) → poproś o hasło →
//   requestEnrollment(password) → startEnrollment(url).
export function useMfa() {
  const client = useAuthClient()
  const queryClient = useQueryClient()
  const state = useMfaState(client)

  const verifyMutation = useMutation<TokenResponse, Error, UseMfaVerifyInput>({
    mutationFn: (input) => {
      const mfaToken = input.mfaToken ?? client.getMfaState().mfaToken
      if (!mfaToken) return Promise.reject(new Error('No pending MFA challenge'))
      return client.verifyMfa({ ...input, mfaToken })
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY }),
  })

  const stepUpMutation = useMutation<TokenResponse, Error, MfaStepUpInput>({
    mutationFn: (input) => client.stepUpMfa(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY }),
  })

  const verify = useMemo(
    () => makeCallable(verifyMutation),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [verifyMutation.isPending, verifyMutation.error, verifyMutation.data, verifyMutation.status],
  )
  const stepUp = useMemo(
    () => makeCallable(stepUpMutation),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stepUpMutation.isPending, stepUpMutation.error, stepUpMutation.data, stepUpMutation.status],
  )

  return {
    stage: state.stage,
    mfaToken: state.mfaToken,
    methods: state.methods,
    enrollmentUrl: state.enrollmentUrl,
    verify,
    stepUp,
    startEnrollment: (url?: string) => client.startMfaEnrollment(url),
    requestEnrollment: (password: string) => client.requestMfaEnrollment({ password }),
    reset: () => client.resetMfa(),
  }
}
