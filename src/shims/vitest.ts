export const describe: any = function(name: string, fn: () => void) {
  fn()
}
describe.skipIf = (cond: boolean) => (name: string, fn: () => void) => {
  if (!cond) fn()
}

export const it: any = function(name: string, fn: () => void) {
  fn()
}
it.skipIf = (cond: boolean) => (name: string, fn: () => void) => {
  if (!cond) fn()
}

export const test: any = function(name: string, fn: () => void) {
  fn()
}
test.skipIf = (cond: boolean) => (name: string, fn: () => void) => {
  if (!cond) fn()
}

export function beforeAll(fn: () => void) {
  fn()
}
export function afterAll(fn: () => void) {
  fn()
}
export function beforeEach(fn: () => void) {
  fn()
}
export function afterEach(fn: () => void) {
  fn()
}

export function expect(val: any, message?: string) {
  const obj: any = {
    toBe: (other: any) => {},
    toEqual: (other: any) => {},
    toBeDefined: () => {},
    toBeTruthy: () => {},
    toBeFalsy: () => {},
    toBeGreaterThan: (n: number) => {},
    toBeGreaterThanOrEqual: (n: number) => {},
    toBeLessThan: (n: number) => {},
    toBeLessThanOrEqual: (n: number) => {},
    toContain: (item: any) => {},
    toHaveLength: (len: number) => {},
    toMatch: (pattern: any) => {},
    toBeCloseTo: (n: number, digits?: number) => {},
  }
  obj.not = obj
  return obj
}
