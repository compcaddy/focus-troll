import { animate, inView, stagger } from "motion"

// Scroll helper
function scrollToSection(id) {
  const el = document.getElementById(id)
  if (el) {
    el.scrollIntoView({ behavior: "smooth" })
  }
}

// Navbar fade-in on load
animate("#navbar", { opacity: 1, y: 0 }, { duration: 0.5, ease: "easeOut" })

// Mobile menu toggle
const menuBtn = document.getElementById("menu-btn")
const mobileMenu = document.getElementById("mobile-menu")
let menuOpen = false

menuBtn.addEventListener("click", () => {
  menuOpen = !menuOpen
  if (menuOpen) {
    mobileMenu.classList.remove("hidden")
    animate(
      mobileMenu,
      { opacity: [0, 1], y: [-5, 0] },
      { duration: 0.3, ease: "easeOut" }
    )
    menuBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
      </svg>`
  } else {
    animate(
      mobileMenu,
      { opacity: [1, 0], y: [0, -5] },
      { duration: 0.3, ease: "easeOut" }
    ).then(() => {
      mobileMenu.classList.add("hidden")
    })
    menuBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8h16M4 16h16"/>
      </svg>`
  }
})

window.addEventListener("DOMContentLoaded", () => {
  // navbar animation
  animate(
    "#navbar",
    { y: [-60, 0], opacity: [0, 1] },
    { duration: 0.6, easing: "ease-out" }
  )
  // QR badge animation
  animate(
    ".qr-badge",
    { y: [200, 0] },
    { duration: 0.8, delay: 1.2, easing: "ease-out" }
  )

  // hero section animation
  animate(
    "header h1",
    { opacity: [0, 1], y: [20, 0] },
    { duration: 0.6, easing: "ease-out" }
  )
  animate(
    "header p",
    { opacity: [0, 1], y: [20, 0] },
    { duration: 0.6, delay: 0.2, easing: "ease-out" }
  )
  animate(
    "header button",
    { opacity: [0, 1], y: [20, 0] },
    { duration: 0.6, delay: 0.4, easing: "ease-out" }
  )
  animate(
    ".heroimg",
    { opacity: [0, 1], y: [80, 0] },
    { duration: 0.8, delay: 0.6, easing: "ease-out" }
  )

  // Add scroll functionality to data-scroll elements
  document.querySelectorAll('[data-scroll]').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault()
      const targetId = link.getAttribute('data-scroll')
      scrollToSection(targetId)
    })
  })
})

// Features section animation
inView("#features", () => {
  animate(
    "#features h2",
    { opacity: [0, 1], y: [30, 0] },
    { duration: 0.6, easing: "ease-out" }
  )

  animate(
    "#features > div > div",
    { opacity: [0, 1], y: [200, 0] },
    { duration: 0.6, delay: stagger(0.25, { start: 0.4 }), easing: "ease-out" }
  )
})

// FAQ section animation
inView("#faq", () => {
  animate(
    "#faq > div:first-child h2",
    { opacity: [0, 1], y: [30, 0] },
    { duration: 0.6, easing: "ease-out" }
  )

  animate(
    "#faq details",
    { opacity: [0, 1], y: [50, 0] },
    {
      duration: 0.6,
      delay: stagger(0.2, { start: 0.4 }),
    }
  )
})

// Footer section animation
inView("footer", () => {
  animate(
    "footer",
    { opacity: [0, 1], y: [200, 0] },
    { duration: 0.8, easing: "ease-out" }
  )
})
