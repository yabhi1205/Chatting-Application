const SavingData = require("../Routes/SavingData")

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
    let prevmessage = await SavingData.findOne({ RandNo: roomid }).select("Messages")
    return prevmessage
}

const addMessage = async (socket, data) => {
    let roomid = await SavingData.findOneAndUpdate(
        { RandNo: socket.data.roomId, 'Users.socketId': socket.id },
        {
            $push: {
                Messages: {
                    Name: data.name, // Replace with the actual name
                    Message: data.message // Replace with the actual message
                }
            }
        },
        {
            new: true, // Return the modified document
            // projection: { RandNo: 1, _id: 0 } // Only return the RandNo field
        }
    ).select("RandNo")
    // console.log(roomid)
    return roomid
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
