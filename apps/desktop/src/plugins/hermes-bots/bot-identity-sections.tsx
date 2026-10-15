import { Button, Codicon, GlyphSpinner, Input, Textarea, useI18n } from '@hermes/plugin-sdk'
import type { ForkMemoryEntry, ForkMemoryListResult } from '@hermes/plugin-sdk'
import { useRef, useState } from 'react'

import {
  addBotMemory,
  cacheBotIdentity,
  cacheBotMemory,
  cancelIdentityRead,
  cancelMemoryRead,
  forkRpcErrorCode,
  forkRpcErrorMessage,
  publishBotIdentity,
  removeBotMemory,
  setBotIdentity,
  updateBotMemory,
  useBotIdentity,
  useBotMemory
} from './bot-identity'
import { botRosterKey } from './data'
import { useBots } from './i18n'
import { ModelPicker } from './model-picker'
import type { RosterRow } from './types'

type IdentityField = 'display_name' | 'role'
type ModelSelection = { model: string; provider: string }

interface EditableIdentityFieldProps {
  label: string
  onSave: (value: string) => Promise<null | string>
  value: string
}

function EditableIdentityField({ label, onSave, value }: EditableIdentityFieldProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [fieldError, setFieldError] = useState('')
  const saving = useRef(false)
  const cancelling = useRef(false)

  const edit = () => {
    setDraft(value)
    setFieldError('')
    setEditing(true)
  }

  const save = async () => {
    if (saving.current) {
      return
    }

    saving.current = true
    const result = await onSave(draft)
    saving.current = false

    if (result) {
      setFieldError(result)
    } else {
      setEditing(false)
      setFieldError('')
    }
  }

  return (
    <div className="grid min-w-0 gap-1">
      <span className="text-ui-xs text-fg-muted">{label}</span>
      {editing ? (
        <Input
          aria-label={label}
          autoFocus
          onBlur={() => {
            if (!cancelling.current) {
              void save()
            }
          }}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void save()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              cancelling.current = true
              setEditing(false)
              event.currentTarget.blur()
              cancelling.current = false
            }
          }}
          value={draft}
        />
      ) : (
        <Button
          aria-label={`${label}: ${value || label}`}
          className="min-w-0 justify-start truncate text-left"
          onClick={edit}
          size="inline"
          variant="text"
        >
          <span className="truncate text-ui-sm text-fg">{value || '—'}</span>
        </Button>
      )}
      {fieldError ? <p className="text-ui-xs text-danger">{fieldError}</p> : null}
    </div>
  )
}

function loadingStatus(label: string) {
  return (
    <div aria-label={label} className="flex justify-center py-3">
      <GlyphSpinner className="text-fg-muted" spinner="breathe" />
    </div>
  )
}

export function BotIdentitySection({ bot }: { bot: RosterRow }) {
  const b = useBots()
  const { t } = useI18n()
  const ownerKey = botRosterKey(bot)
  const { data, error, refetch } = useBotIdentity(bot)
  const [notice, setNotice] = useState<{ key: string; message: string; kind: 'error' | 'notice' } | null>(null)
  const [savingKey, setSavingKey] = useState<null | string>(null)
  const [instructionsEdit, setInstructionsEdit] = useState<null | { key: string; value: string }>(null)
  const [modelDraft, setModelDraft] = useState<null | { key: string; value: ModelSelection }>(null)

  const [confirmation, setConfirmation] = useState<
    null | { key: string; message: string; revision: number; value: ModelSelection }
  >(null)

  const currentNotice = notice?.key === ownerKey ? notice : null
  const isSaving = savingKey === ownerKey
  const currentInstructions = instructionsEdit?.key === ownerKey ? instructionsEdit.value : ''
  const editingInstructions = instructionsEdit?.key === ownerKey
  const currentModelDraft = modelDraft?.key === ownerKey ? modelDraft.value : null
  const currentConfirmation = confirmation?.key === ownerKey ? confirmation : null

  const refreshConflict = async () => {
    await refetch()
    setNotice({ key: ownerKey, kind: 'notice', message: b.identity.changedElsewhere })
  }

  const saveField = async (field: IdentityField, value: string): Promise<null | string> => {
    if (field === 'display_name' && !value.trim()) {
      return b.identity.emptyName
    }

    setSavingKey(ownerKey)
    setNotice(null)

    try {
      await cancelIdentityRead(bot)

      const patch =
        field === 'display_name'
          ? { display_name: value, expected_revision: data?.revision }
          : { role: value, expected_revision: data?.revision }

      const result = await setBotIdentity(bot, patch)

      cacheBotIdentity(bot, result)
      publishBotIdentity(bot, result)

      return null
    } catch (saveError) {
      if (forkRpcErrorCode(saveError) === 4091) {
        await refreshConflict()

        return null
      }

      return b.identity.saveFailed
    } finally {
      setSavingKey(current => (current === ownerKey ? null : current))
    }
  }

  const saveInstructions = async () => {
    if (!data || isSaving) {
      return
    }

    setSavingKey(ownerKey)
    setNotice(null)

    try {
      await cancelIdentityRead(bot)

      const result = await setBotIdentity(bot, {
        expected_revision: data.revision,
        instructions: currentInstructions
      })

      cacheBotIdentity(bot, result)
      publishBotIdentity(bot, result)
      setInstructionsEdit(current => (current?.key === ownerKey ? null : current))
    } catch (saveError) {
      if (forkRpcErrorCode(saveError) === 4091) {
        await refreshConflict()
        setInstructionsEdit(current => (current?.key === ownerKey ? null : current))
      } else {
        setNotice({ key: ownerKey, kind: 'error', message: b.identity.saveFailed })
      }
    } finally {
      setSavingKey(current => (current === ownerKey ? null : current))
    }
  }

  const saveModel = async (value: ModelSelection, confirmExpensive = false, expectedRevision = data?.revision) => {
    if (!data || isSaving) {
      return
    }

    setModelDraft({ key: ownerKey, value })
    setSavingKey(ownerKey)
    setNotice(null)

    try {
      await cancelIdentityRead(bot)

      const result = await setBotIdentity(bot, {
        expected_revision: expectedRevision,
        model: value.model,
        provider: value.provider,
        ...(confirmExpensive ? { confirm_expensive_model: true } : {})
      })

      if (result.confirm_required) {
        setConfirmation({
          key: ownerKey,
          message: result.confirm_message || '',
          revision: expectedRevision ?? data.revision,
          value
        })

        return
      }

      cacheBotIdentity(bot, result)
      publishBotIdentity(bot, result)
      setModelDraft(current => (current?.key === ownerKey ? null : current))
      setConfirmation(current => (current?.key === ownerKey ? null : current))
    } catch (saveError) {
      if (forkRpcErrorCode(saveError) === 4091) {
        await refreshConflict()
      } else {
        setNotice({ key: ownerKey, kind: 'error', message: b.identity.modelSaveFailed })
      }

      setModelDraft(current => (current?.key === ownerKey ? null : current))
      setConfirmation(current => (current?.key === ownerKey ? null : current))
    } finally {
      setSavingKey(current => (current === ownerKey ? null : current))
    }
  }

  if (!data) {
    return error ? (
      <div className="grid gap-2 px-3 pb-3 pt-1">
        <p className="text-ui-xs text-danger">{b.identity.loadFailed}</p>
        <Button onClick={() => void refetch()} size="xs" variant="ghost">
          {t.common.retry}
        </Button>
      </div>
    ) : (
      loadingStatus(t.common.loading)
    )
  }

  const instructionPreview = data.instructions.split('\n').slice(0, 3).join('\n').trim()

  return (
    <div className="grid gap-3 px-3 pb-3 pt-1" data-testid="bot-identity-section">
      <div className="grid grid-cols-2 gap-3">
        <EditableIdentityField
          key={`${ownerKey}:name`}
          label={b.identity.name}
          onSave={value => saveField('display_name', value)}
          value={data.display_name}
        />
        <EditableIdentityField
          key={`${ownerKey}:role`}
          label={b.identity.role}
          onSave={value => saveField('role', value)}
          value={data.role}
        />
      </div>

      <div className="grid gap-2">
        <span className="text-ui-xs text-fg-muted">{b.identity.model}</span>
        <ModelPicker
          bot={bot}
          onChange={patch => {
            const base = currentModelDraft || {
              model: data.model.default,
              provider: data.model.provider
            }

            const value = {
              model: 'model' in patch ? patch.model : base.model,
              provider: 'provider' in patch ? patch.provider : base.provider
            }

            setConfirmation(null)
            void saveModel(value)
          }}
          value={
            currentModelDraft || {
              model: data.model.default,
              provider: data.model.provider
            }
          }
        />
        {currentConfirmation ? (
          <div className="grid gap-2" role="alert">
            <p className="text-ui-xs text-warning">{currentConfirmation.message || b.identity.confirmModel}</p>
            <div className="flex flex-wrap gap-1">
              <Button
                disabled={isSaving}
                onClick={() => {
                  void saveModel(currentConfirmation.value, true, currentConfirmation.revision)
                }}
                size="xs"
              >
                {b.identity.confirm}
              </Button>
              <Button
                disabled={isSaving}
                onClick={() => {
                  setConfirmation(null)
                  setModelDraft(null)
                }}
                size="xs"
                variant="ghost"
              >
                {t.common.cancel}
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="grid gap-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-ui-xs text-fg-muted">{b.identity.instructions}</span>
          {editingInstructions ? null : (
            <Button
              onClick={() => setInstructionsEdit({ key: ownerKey, value: data.instructions })}
              size="xs"
              variant="ghost"
            >
              {b.identity.edit}
            </Button>
          )}
        </div>
        {editingInstructions ? (
          <div className="grid gap-2">
            <Textarea
              aria-label={b.identity.instructions}
              onChange={event => setInstructionsEdit({ key: ownerKey, value: event.target.value })}
              rows={5}
              value={currentInstructions}
            />
            <div className="flex gap-1">
              <Button disabled={isSaving} onClick={() => void saveInstructions()} size="xs">
                {isSaving ? t.common.saving : t.common.save}
              </Button>
              <Button disabled={isSaving} onClick={() => setInstructionsEdit(null)} size="xs" variant="ghost">
                {t.common.cancel}
              </Button>
            </div>
          </div>
        ) : (
          <p className="whitespace-pre-wrap text-ui-xs text-fg-secondary">
            {instructionPreview || <span className="text-fg-subtle">—</span>}
          </p>
        )}
        <p className="text-ui-xs text-fg-muted">{b.identity.nextChatNote}</p>
      </div>

      {currentNotice ? (
        <p className={currentNotice.kind === 'error' ? 'text-ui-xs text-danger' : 'text-ui-xs text-fg-muted'} role="status">
          {currentNotice.message}
        </p>
      ) : null}
      {isSaving ? <span className="text-ui-xs text-fg-muted">{t.common.saving}</span> : null}
    </div>
  )
}

interface MemoryGroupProps {
  bot: RosterRow
  entries: ForkMemoryEntry[]
  enabled: boolean
  label: string
  onMutation: (action: () => Promise<ForkMemoryListResult>) => Promise<void>
  target: 'memory' | 'user'
  usage: { limit: number; used: number }
}

function MemoryGroup({ bot, entries, enabled, label, onMutation, target, usage }: MemoryGroupProps) {
  const b = useBots()
  const { t } = useI18n()
  const [editing, setEditing] = useState<null | { id: string; value: string }>(null)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [removing, setRemoving] = useState<null | string>(null)

  const startAdd = () => {
    setDraft('')
    setAdding(true)
  }

  return (
    <section className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="m-0 text-ui-sm font-medium text-fg">{label}</h3>
        <span aria-label={b.memory.usage} className="font-mono text-ui-xs tabular-nums text-fg-muted">
          {usage.used} / {usage.limit}
        </span>
      </div>
      {!enabled ? <p className="m-0 text-ui-xs text-fg-muted">{b.memory.writesOff}</p> : null}
      {entries.length ? (
        <ul className="m-0 grid list-none gap-2 p-0">
          {entries.map(entry => (
            <li className="grid gap-1" key={entry.id}>
              {editing?.id === entry.id ? (
                <>
                  <Textarea
                    aria-label={label}
                    onChange={event => setEditing({ id: entry.id, value: event.target.value })}
                    rows={3}
                    value={editing.value}
                  />
                  <div className="flex gap-1">
                    <Button
                      onClick={() => {
                        void onMutation(() => updateBotMemory(bot, entry.id, editing.value))
                        setEditing(null)
                      }}
                      size="xs"
                    >
                      {t.common.save}
                    </Button>
                    <Button onClick={() => setEditing(null)} size="xs" variant="ghost">
                      {t.common.cancel}
                    </Button>
                  </div>
                </>
              ) : (
                <div className="flex min-w-0 items-start gap-1">
                  {enabled ? (
                    <Button
                      aria-label={`${b.identity.edit} ${label}`}
                      className="min-w-0 flex-1 justify-start whitespace-normal break-words text-left"
                      onClick={() => setEditing({ id: entry.id, value: entry.text })}
                      size="inline"
                      variant="text"
                    >
                      <span className="text-ui-xs text-fg-secondary">{entry.text}</span>
                    </Button>
                  ) : (
                    <p className="m-0 min-w-0 flex-1 break-words text-ui-xs text-fg-secondary">{entry.text}</p>
                  )}
                  {enabled && removing === entry.id ? (
                    <span className="flex shrink-0 items-center gap-1 text-ui-xs text-fg-muted">
                      <span>{b.memory.removePrompt}</span>
                      <Button
                        onClick={() => {
                          void onMutation(() => removeBotMemory(bot, entry.id))
                          setRemoving(null)
                        }}
                        size="xs"
                        variant="text"
                      >
                        {b.memory.removeYes}
                      </Button>
                      <Button onClick={() => setRemoving(null)} size="xs" variant="text">
                        {b.memory.removeNo}
                      </Button>
                    </span>
                  ) : enabled ? (
                    <Button
                      aria-label={t.common.remove}
                      onClick={() => setRemoving(entry.id)}
                      size="icon-xs"
                      variant="ghost"
                    >
                      <Codicon name="trash" />
                    </Button>
                  ) : null}
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-ui-xs text-fg-muted">—</p>
      )}
      {enabled && adding ? (
        <div className="grid gap-2">
          <Textarea
            aria-label={`${b.memory.add} ${label}`}
            onChange={event => setDraft(event.target.value)}
            placeholder={b.memory.placeholder}
            rows={3}
            value={draft}
          />
          <div className="flex gap-1">
            <Button
              disabled={!draft.trim()}
              onClick={() => {
                void onMutation(() => addBotMemory(bot, target, draft.trim()))
                setAdding(false)
              }}
              size="xs"
            >
              {b.memory.add}
            </Button>
            <Button onClick={() => setAdding(false)} size="xs" variant="ghost">
              {t.common.cancel}
            </Button>
          </div>
        </div>
      ) : enabled ? (
        <Button className="justify-self-start" onClick={startAdd} size="xs" variant="ghost">
          <Codicon name="add" />
          {b.memory.add}
        </Button>
      ) : null}
    </section>
  )
}

export function BotMemorySection({ bot }: { bot: RosterRow }) {
  const b = useBots()
  const { t } = useI18n()
  const ownerKey = botRosterKey(bot)
  const { data, error, refetch } = useBotMemory(bot)
  const [status, setStatus] = useState<null | { key: string; message: string; kind: 'error' | 'notice' }>(null)
  const [busyKey, setBusyKey] = useState<null | string>(null)

  const mutate = async (action: () => Promise<ForkMemoryListResult>) => {
    setBusyKey(ownerKey)
    setStatus(null)
    await cancelMemoryRead(bot)

    try {
      cacheBotMemory(bot, await action())
    } catch (mutationError) {
      const code = forkRpcErrorCode(mutationError)

      if (code === 4093) {
        await refetch()
        setStatus({ key: ownerKey, kind: 'notice', message: b.memory.changedElsewhere })
      } else {
        const detail = code === 4094 ? forkRpcErrorMessage(mutationError) : ''
        setStatus({
          key: ownerKey,
          kind: 'error',
          message: b.memory.writeFailed(detail || b.memory.loadFailed)
        })
      }
    } finally {
      setBusyKey(current => (current === ownerKey ? null : current))
    }
  }

  if (!data) {
    return error ? (
      <div className="grid gap-2 px-3 pb-3 pt-1">
        <p className="text-ui-xs text-danger">{b.memory.loadFailed}</p>
        <Button onClick={() => void refetch()} size="xs" variant="ghost">
          {t.common.retry}
        </Button>
      </div>
    ) : (
      loadingStatus(t.common.loading)
    )
  }

  const memoryStatus = status?.key === ownerKey ? status : null

  return (
    <div className="grid gap-4 px-3 pb-3 pt-1" data-testid="bot-memory-section">
      <MemoryGroup
        bot={bot}
        enabled={data.enabled.memory}
        entries={data.entries.filter(entry => entry.target === 'memory')}
        key={`${ownerKey}:memory`}
        label={b.memory.whatItRemembers}
        onMutation={mutate}
        target="memory"
        usage={data.usage.memory}
      />
      <MemoryGroup
        bot={bot}
        enabled={data.enabled.user}
        entries={data.entries.filter(entry => entry.target === 'user')}
        key={`${ownerKey}:user`}
        label={b.memory.aboutYou}
        onMutation={mutate}
        target="user"
        usage={data.usage.user}
      />
      {memoryStatus ? (
        <p className={memoryStatus.kind === 'error' ? 'text-ui-xs text-danger' : 'text-ui-xs text-fg-muted'} role="status">
          {memoryStatus.message}
        </p>
      ) : null}
      {busyKey === ownerKey ? <span className="text-ui-xs text-fg-muted">{t.common.saving}</span> : null}
    </div>
  )
}
