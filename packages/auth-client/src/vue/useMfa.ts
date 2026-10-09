import { computed, onScopeDispose, shallowRef, type ComputedRef, type ShallowRef } from 'vue'
import { useMutation, useQueryClient, type UseMutationReturnType } from '@tanstack/vue-query'
import type { AuthClient } from '../core/client.js'
import type { MfaState, MfaStepUpInput, MfaVerifyInput, TokenResponse } from '../core/types.js'
import { useAuthClient } from './useAuthClient.js'
import { ME_QUERY_KEY } from './key.js'

// Reaktywny stan 2FA z klienta (odpinany przy dispose scope).
export function useMfaState(client: AuthClient): ShallowRef<MfaState> {
  const state = shallowRef(client.getMfaState())
  const off = client.on('mfa-state-changed', (next) => {
    state.value = next
  })
  onScopeDispose(off)
  return state
}

type CallableMutation<TData, TVariables> = UseMutationReturnType<
  TData,
  Error,
  TVariables,
  unknown
> &
  ((variables: TVariables) => Promise<TData>)

function makeCallable<TData, TVariables>(
  mutation: UseMutationReturnType<TData, Error, TVariables, unknown>,
): CallableMutation<TData, TVariables> {
  const fn = ((variables: TVariables) => mutation.mutateAsync(variables)) as CallableMutation<
    TData,
    TVariables
  >
  return Object.assign(fn, mutation)
}

export type UseMfaVerifyInput = Omit<MfaVerifyInput, 'mfaToken'> & { mfaToken?: string }

export type UseMfaReturn = {
  stage: ComputedRef<MfaState['stage']>
  mfaToken: ComputedRef<string | null>
  methods: ComputedRef<string[]>
  enrollmentUrl: ComputedRef<string | null>
  verify: CallableMutation<TokenResponse, UseMfaVerifyInput>
  stepUp: CallableMutation<TokenResponse, MfaStepUpInput>
  startEnrollment: (url?: string) => Promise<void>
  // Wymaga aktualnego hasła usera (sama sesja nie wystarcza).
  requestEnrollment: (password: string) => Promise<string>
  reset: () => void
}

// 2FA w Vue — odpowiednik React useMfa (ten sam stan z klienta).
export function useMfa(): UseMfaReturn {
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

  return {
    stage: computed(() => state.value.stage),
    mfaToken: computed(() => state.value.mfaToken),
    methods: computed(() => state.value.methods),
    enrollmentUrl: computed(() => state.value.enrollmentUrl),
    verify: makeCallable(verifyMutation),
    stepUp: makeCallable(stepUpMutation),
    startEnrollment: (url?: string) => client.startMfaEnrollment(url),
    requestEnrollment: (password: string) => client.requestMfaEnrollment({ password }),
    reset: () => client.resetMfa(),
  }
}
