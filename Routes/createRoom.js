const { readFileSync } = require("fs")
const path = require("path")
const SavingData = require("./SavingData")
const Router = require("express").Router()

// let welcome = require("../public/Welcome.html")

module.exports = function (io) {

    // For Createroom

    Router.get("/createRoom/", async (req, res) => {
        try {

            let html = readFileSync(path.join(__dirname, '../static', 'createRoom.html'), "utf-8")
            let existingRoomsList = await SavingData.find(
                {},
                { _id: false },
                {
                    projection: {
                        // _id: 0,
                        RandNo: 1
                    }
                })
            let existinglist = existingRoomsList.map((element) => {
                return element.RandNo
            })
            let randomNumber = Math.floor((Math.random() * 1000000) + 1);
            while (existinglist.includes(randomNumber)) {
                randomNumber = Math.floor((Math.random() * 1000000) + 1);
            }
            // while(randomNumber in existingRoomsList[])
            html = html.replace("ABHINAVYADAV", randomNumber)
            return res.send(html)
        } catch (error) {
            return res.status(500).json({ success: false, error: "Internal Server Error " })
        }
    })
    Router.post("/createRoom/demo", async (req, res) => {
        try {
            if (!req.body.RandNo) {
                return res.status(400).json({ success: false, error: "please add rand no." })
            }
            let checkRandomNumber = await SavingData.findOne({ RandNo: req.body.RandNo }).select("id")
            if (checkRandomNumber) {
                return res.status(400).json({ success: false, error: "This already exists." })
            }
            // let createNumber = true
            let createNumber = await SavingData.create({
                RandNo: req.body.RandNo
            })
            if (!createNumber) {
                return res.status(400).json({ success: false, error: "Try again!" })
            }
            return res.status(200).cookie("room", req.body.RandNo).redirect("/chatting")
        } catch (err) {
            console.log(err)
            return res.status(500).json({ success: false, error: "internal Server error!" })
        }
    })


    // For Chatting

    Router.post("/chatting/", async (req, res) => {
        let html = readFileSync(path.join(__dirname, '../static', 'chatting.html'), "utf-8")
        return res.send(html)
    })
    Router.get("/chatting/", async (req, res) => {
        let html = readFileSync(path.join(__dirname, '../static', 'chatting.html'), "utf-8")
        return res.send(html)
    })


    // For JoinRoom
    Router.get("/joinRoom/", async (req, res) => {
        let html = readFileSync(path.join(__dirname, '../static', 'joinroom.html'), "utf-8")
        return res.send(html)
    })

    Router.post("/joinRoom/demo", async (req, res) => {
        try {

            if (!req.body.roomId) {
                return res.status(400).send({ success: false, error: "please enter the roomid" })
            }
            let existingRoom = await SavingData.findOne({ RandNo: req.body.roomId }).select("_id")
            // console.log(req.body,existingRoom)
            if (!existingRoom) {
                return res.status(400).send({ success: false, error: "Please create a room!" })
            }

            return res.cookie("room", req.body.roomId).redirect("/chatting")
        } catch (err) {
            console.log(err)
            return res.status(500).json({ success: false, error: "internal Server error!" })
        }
    })


    return Router
}
