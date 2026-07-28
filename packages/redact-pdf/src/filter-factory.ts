// The stock filter factory builds SVG filter elements and appends them to the
// document body. Returning "none" is what pdf.js's own base class does, and it is
// what runs when a page uses no filters at all.
class NoFilterFactory {
  addFilter() {
    return "none";
  }

  addHCMFilter() {
    return "none";
  }

  addAlphaFilter() {
    return "none";
  }

  addLuminosityFilter() {
    return "none";
  }

  addKnockoutFilter() {
    return "none";
  }

  addHighlightHCMFilter() {
    return "none";
  }

  addSelectionHCMFilter() {
    return "none";
  }

  addSelectionFilter() {
    return "none";
  }

  createSelectionStyle() {
    return null;
  }

  destroy() {
    return undefined;
  }
}

export { NoFilterFactory };
