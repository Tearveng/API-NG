module.exports = {
  apps: [
    {
      name: "api-ng",
      script: "dist/main.js",
      watch: "./dist",
      ignore_watch: ["./node_modules"],
      env:{
        "NODE_ENV":'production'
      }
    },
  ],

};
