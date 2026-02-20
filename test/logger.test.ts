import { describe, it, expect, vi, beforeEach } from 'vitest'
import { log } from '../src/utils/logger'

describe('log', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('logs info messages to console.log', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    log({ level: 'info', msg: 'test info' })
    expect(spy).toHaveBeenCalledOnce()
    expect(spy.mock.calls[0][0]).toContain('[INFO]')
    expect(spy.mock.calls[0][0]).toContain('test info')
  })

  it('logs error messages to console.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const err = new Error('boom')
    log({ level: 'error', msg: 'test error', error: err })
    expect(spy).toHaveBeenCalledOnce()
    expect(spy.mock.calls[0][0]).toContain('[ERROR]')
    expect(spy.mock.calls[0][0]).toContain('test error')
    expect(spy.mock.calls[0][1]).toBe(err)
  })

  it('logs error with empty string when no error provided', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    log({ level: 'error', msg: 'no error obj' })
    expect(spy).toHaveBeenCalledOnce()
    expect(spy.mock.calls[0][1]).toBe('')
  })

  it('logs warn messages to console.warn', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    log({ level: 'warn', msg: 'test warn' })
    expect(spy).toHaveBeenCalledOnce()
    expect(spy.mock.calls[0][0]).toContain('[WARN]')
    expect(spy.mock.calls[0][0]).toContain('test warn')
  })

  it('logs debug messages only when DEBUG=true', () => {
    const original = process.env.DEBUG
    process.env.DEBUG = 'true'
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})

    log({ level: 'debug', msg: 'debug msg', meta: { key: 'val' } })
    expect(spy).toHaveBeenCalledOnce()
    expect(spy.mock.calls[0][0]).toContain('[DEBUG]')
    expect(spy.mock.calls[0][1]).toEqual({ key: 'val' })

    process.env.DEBUG = original
  })

  it('suppresses debug messages when DEBUG is not true', () => {
    const original = process.env.DEBUG
    delete process.env.DEBUG
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})

    log({ level: 'debug', msg: 'should not appear' })
    expect(spy).not.toHaveBeenCalled()

    process.env.DEBUG = original
  })

  it('logs debug with empty object when no meta provided', () => {
    const original = process.env.DEBUG
    process.env.DEBUG = 'true'
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})

    log({ level: 'debug', msg: 'no meta' })
    expect(spy).toHaveBeenCalledOnce()
    expect(spy.mock.calls[0][1]).toBe('')

    process.env.DEBUG = original
  })
})
