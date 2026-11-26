// Док контактов: раскрытие, закрытие по Esc/клику мимо, прячется над подвалом и кнопками формы ([data-dock-avoid]).
const dock = document.querySelector(".contact-dock");

if (dock) {
  const toggle = dock.querySelector(".contact-dock__toggle");
  const setOpen = (open) => {
    dock.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", String(open));
  };

  toggle.addEventListener("click", () => setOpen(!dock.classList.contains("is-open")));
  document.addEventListener("click", (e) => {
    if (!dock.contains(e.target)) setOpen(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && dock.classList.contains("is-open")) {
      setOpen(false);
      toggle.focus();
    }
  });

  const visible = new Set();
  const refresh = () => dock.classList.toggle("is-hidden", visible.size > 0);
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => (e.isIntersecting ? visible.add(e.target) : visible.delete(e.target)));
      if (visible.size) setOpen(false);
      refresh();
    },
    { rootMargin: "0px 0px -0px 0px", threshold: 0 },
  );
  const watch = (root = document) => root.querySelectorAll("[data-dock-avoid]").forEach((el) => io.observe(el));
  watch();
  new MutationObserver(() => watch()).observe(document.body, { childList: true, subtree: true });
}
