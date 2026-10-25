/** Run on a desktop preview to protect icons when navigation collapses to a rail. */
export async function workspaceIconsTest() {
  if (!matchMedia('(min-width: 761px)').matches) {
    throw new Error('Use a desktop viewport for the collapsed navigation check.')
  }
  const region = document.querySelector('.sidebar-region')
  const toggle = document.querySelector('.sidebar-toggle')
  if (!region || !(toggle instanceof HTMLButtonElement)) {
    throw new Error('Workspace navigation is missing.')
  }
  const collapsed = region.classList.contains('sidebar-collapsed')
  try {
    if (!collapsed) {
      toggle.click()
      await new Promise((resolve) => requestAnimationFrame(resolve))
    }
    for (const icon of document.querySelectorAll('.sidebar-region .study-icon svg')) {
      const box = icon.getBoundingClientRect()
      if (box.width <= 0 || box.height <= 0) {
        throw new Error('Collapsed navigation must keep every icon visible.')
      }
    }
    if (!document.querySelector('.sidebar-region .study-icon svg')) {
      throw new Error('Navigation icons are missing.')
    }
    return 'Collapsed navigation, Settings and expand-toggle icons stay visible'
  } finally {
    if (region.classList.contains('sidebar-collapsed') !== collapsed) {
      toggle.click()
    }
  }
}
