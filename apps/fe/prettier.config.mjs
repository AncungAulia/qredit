/** @type {import("prettier").Config} */
const config = {
  printWidth: 100,
  plugins: ["prettier-plugin-tailwindcss"],
  // Tailwind v4: point the plugin at the CSS entry that imports tailwindcss.
  tailwindStylesheet: "./src/app/globals.css",
};

export default config;
