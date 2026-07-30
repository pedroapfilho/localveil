// A strong ease-out: the built-in curves are too weak to read at this duration, and
// short enough that the page arranges itself rather than performing.
const APPEAR = { duration: 0.2, ease: [0.23, 1, 0.32, 1] } as const;

// Capped so that dropping twenty files does not make the last one wait a second for
// its turn. Stagger is decoration and must never hold up the reading of the list.
const STAGGER_STEP = 0.04;
const STAGGER_CAP = 5;

const staggered = (index: number) => ({
  ...APPEAR,
  delay: Math.min(index, STAGGER_CAP) * STAGGER_STEP,
});

const SLIDE = {
  animate: { opacity: 1, transform: "translateY(0px)" },
  exit: { opacity: 0, transform: "translateY(-6px)" },
  initial: { opacity: 0, transform: "translateY(-6px)" },
};

export { APPEAR, SLIDE, staggered };
