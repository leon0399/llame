"use client"

import { useState, useCallback } from "react"
import Cookies from "js-cookie"

const defaultCookieOptions: Cookies.CookieAttributes = {
  path: '/',
  expires: 365,
  sameSite: 'lax'
}

// Overloaded signatures for conditional typing based on defaultValue presence
function useCookie<T extends string>(
  name: string
): [T | undefined, (newValue: T | undefined, options?: Cookies.CookieAttributes) => void, () => void]

function useCookie<T extends string>(
  name: string, 
  defaultValue: T
): [T, (newValue: T, options?: Cookies.CookieAttributes) => void, () => void]

function useCookie<T extends string>(
  name: string, 
  defaultValue?: T
): [T | undefined, (newValue: T | undefined, options?: Cookies.CookieAttributes) => void, () => void] {
  
  const [value, setValue] = useState<T | undefined>(() => {
    const cookie = Cookies.get(name)
    if (cookie) {
      return cookie as T
    }
    if (defaultValue !== undefined) {
      Cookies.set(name, defaultValue, defaultCookieOptions)
      return defaultValue
    }
    return undefined
  })

  const updateCookie = useCallback(
    (newValue: T | undefined, options: Cookies.CookieAttributes = defaultCookieOptions) => {
      if (newValue === undefined) {
        Cookies.remove(name)
        setValue(undefined)
      } else {
        Cookies.set(name, newValue, options)
        setValue(newValue)
      }
    },
    [name]
  )

  const deleteCookie = useCallback(() => {
    Cookies.remove(name)
    setValue(undefined)
  }, [name])

  return [value, updateCookie, deleteCookie]
}

export default useCookie