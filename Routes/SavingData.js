const mongoose = require("mongoose");
const SavingData = new mongoose.Schema({
    RandNo: {
        type: String,
        required: true,
        unique: true,
    },
    Users: [
        {
            socketId: {
                type: String,
                required: true,
            },
            Name: {
                type: String,
                required: true
            }
        }
    ],
    Messages: [
        {
            Name:{
                type:String,
                required:true,
                maxlength: 2000
            },
            Message:{
                type:String,
                required:true
            },
            IsCode:{ type:Boolean, default:false },
            Attachments:[{
                Name:{ type:String, required:true, maxlength:255 },
                Type:{ type:String, required:true, maxlength:120 },
                Data:{ type:String, required:true }
            }],
            timestamp:{
                type:Date,
                default:Date.now
            }
        }
    ],
    timestamp: {
        type: Date,
        default: Date.now
    }
});
module.exports = mongoose.model('SavingData', SavingData)
