const SavingData = require("../Routes/SavingData")
const ChatMessage = require("../Routes/ChatMessage")

const addUser = async (socket, data) => {
    let temp = await SavingData.findOneAndUpdate(
        { RandNo: data.roomId },
        {
            $push: {
                Users: {
                    socketId: socket.id,
                    Name: data.name
                }
            }
        }
    )
    // console.log(temp)
}
const prevMessage = async (roomid) => {
    const room = await SavingData.findOne({ RandNo: roomid }).select("Messages")
    if (!room) return null
    const recent = await ChatMessage.find({ RoomId: roomid }).sort({ timestamp: 1 }).lean()
    return { Messages: [...(room.Messages || []), ...recent] }
}

const addMessage = async (socket, data) => {
    const room = await SavingData.findOne({ RandNo: socket.data.roomId, 'Users.socketId': socket.id }).select("RandNo")
    if (!room) return null
    await ChatMessage.create({ RoomId: room.RandNo, Name: data.name, Message: data.message, IsCode: data.isCode, Attachments: data.attachments })
    return room
}

const deleteUser = async (socket) => {
    let updatedUsers = await SavingData.findOneAndUpdate(
        { RandNo: socket.data.roomId, 'Users.socketId': socket.id },
        {
            $pull: { 'Users': { socketId: socket.id } }
        },
        {
            new: true,
            projection: {
                "Users": 1,
                "RandNo":1,
                "_id":0
            }
        }
    )

    // console.log("ashdgbajdasjdvas",updatedUsers)
    return updatedUsers;
}
module.exports = { addUser, prevMessage, addMessage, deleteUser }
