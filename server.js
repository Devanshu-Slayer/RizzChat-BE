require("dotenv").config()
let express = require("express")
let http = require("http")
let {Server} = require("socket.io")
let cors = require("cors")
let aiChat = require("./ai-chat")
let judge = require("./judge")

let app = express()
let httpServer = http.createServer(app)
let io = new Server(httpServer, {cors:{origin:"*"}})

app.use(cors({ origin: "*" }))
app.use(express.json())

app.use("/api/ai", aiChat)
app.use("/api/judge", judge)

io.on("connection",(socket)=>{
    console.log("User connected",socket.id)
    socket.on("message",(obj)=>{
        io.emit("message",obj)
    })
    socket.on("disconnect",()=>{
        console.log("User disconnected",socket.id)
    })
})

httpServer.listen(3000,()=>console.log("I am Listening"))