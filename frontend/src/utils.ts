declare global {
  interface Window {
    debugClickTimer: number;
    debugTouchCount: number;
    refreshRestaurantsTimer: number;
    refreshHistoryTimer: number;
    errorMessageTimer: number;
  }
}

  function addDebugClick(node: HTMLElement, callback: () => void, triggerCount = 5) {
    node.addEventListener('click', () => {
      if (window.debugClickTimer) {
          window.clearTimeout(window.debugClickTimer)
      }
      if (typeof window.debugTouchCount !== 'number') {
          window.debugTouchCount = 0
      }
      window.debugTouchCount++
      window.debugClickTimer = setTimeout(() => {
          if (typeof window.debugTouchCount === 'number' && window.debugTouchCount >= triggerCount) {
              callback()
          }
          window.debugTouchCount = 0
      }, 300)
    })
  }

  function httpFetch(url: RequestInfo | URL, params?: RequestInit): Promise<Response> {
    const baseServer = import.meta.env.VITE_BASE_SERVER || "";
    return fetch(`${baseServer}${url}`, params)
  }

  export {
    addDebugClick,
    httpFetch
  }