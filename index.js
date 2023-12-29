require('dotenv').config()
const express = require('express')
const http = require('http')
const app = express()
const server = http.createServer(app)

express.static(__dirname)

app.use("/",(req,res)=>{
    res.sendFile(__dirname+"/public/index.html")
})


server.listen(process.env.PORT,()=>{
    console.log(`Server is Successfully Started at http://localhost:${process.env.PORT}`)
})