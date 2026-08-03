const APPEAR = { duration: 0.2, ease: [0.23, 1, 0.32, 1] } as const;

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
