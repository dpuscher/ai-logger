export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "body-max-line-length": [0, "always", Number.POSITIVE_INFINITY],
    "footer-max-line-length": [0, "always", Number.POSITIVE_INFINITY],
  },
};
