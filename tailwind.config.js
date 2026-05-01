// Tailwind CSS configuration. The CLI scans the paths below for class
// references at build time; anything not mentioned in those files is tree-
// shaken from the output CSS.

export default {
  content: [
    "./client/src/index.html",
    "./client/src/**/*.js",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
