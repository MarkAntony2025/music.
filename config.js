module.exports = {
    prefix: '!',
    nodes: [{
        host: "lavalink.jirayu.net",
        password: "youshallnotpass",
        port: 13592,
        secure: false,
        name: "Main Node"
    }],
    spotify: {
        clientId: "a568b55af1d940aca52ea8fe02f0d93b",
        clientSecret: "e8199f4024fe49c5b22ea9dd0c4789"
    },
    botToken: "",
    embedColor: "#0061ff",
    port: process.env.PORT || 3000  // Only needed if hosting a web server/dashboard
};
