export function useRouter() {
  return {
    push: (url: string) => {
      window.location.hash = url
    },
    replace: (url: string) => {
      window.location.hash = url
    },
    back: () => {
      window.history.back()
    },
    forward: () => {
      window.history.forward()
    },
    prefetch: () => {},
  }
}

export function usePathname() {
  return window.location.pathname
}

export function useSearchParams() {
  return new URLSearchParams(window.location.search)
}

export function useParams() {
  return {}
}

export function notFound(): never {
  throw new Error('404 Not Found')
}
