require('dotenv').config()
require('./db')();
const express = require('express')
// const status = require("express-status-monitor")
const http = require('http')
const { Server } = require('socket.io')
const cors = require('cors');
const { readFileSync } = require('fs');
const SavingData = require('./Routes/SavingData.js');
const { addUser, prevMessage, addMessage, deleteUser } = require('./Utlity/Database.js');
const app = express()
app.use(express.json())
app.use(cors())
const server = http.createServer(app)
// app.use(status())
app.use(express.static(__dirname + "/public"))
const io = new Server(server);


app.use("/", require("./Routes/createRoom.js")(io))

// let roomid=""


io.on("connection", (socket) => {
    console.log(socket.id)
    socket.on("join-room",async(data)=>{
        socket.join(data.roomId)
        socket.to(data.roomId).emit("new-user","New User added: "+data.name)
        // roomid = data.roomId
        await addUser(socket,data)
        let prevmessage = await prevMessage(data.roomId)
        if(prevmessage.Messages){
            prevmessage.Messages.forEach(element => {
                socket.emit("recieveMessage",{name: element.Name, message: element.Message})
            });
        }
    })
    socket.on("sendMessage",async(data)=>{
        let roomid = await addMessage(socket,data)
        socket.to(roomid.RandNo).emit("recieveMessage",data)
    })
    // socket.to(roomid).emit("receiveMessage",)

    socket.on('disconnect', async(socket) => {
        // await deleteUser(socket)
        // console.log("a user disconnected "+socket.id)
    })
    socket.on('UserDisconnect', async(data) => {
        await deleteUser(socket)
        console.log("a user "+socket.id)
    })
})

// io.on('connection', (socket) => {
//     console.log("connection",socket.id)
//     socket.on("disconnect",()=>{
//         console.log("disconnect",socket.id)
//     })
// });

// io.on("disconnect",(socket)=>{
// })

server.listen(process.env.PORT, () => {
    console.log(`Server is Successfully Started at http://localhost:${process.env.PORT}`)
})