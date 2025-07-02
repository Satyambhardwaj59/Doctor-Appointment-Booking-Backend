import mongoose from "mongoose";

const connectDB = async () => {
    mongoose.connection.on('connected', () => {
        console.log("Database Connected successfully");
    })
    await mongoose.connect(`${process.env.MONGODB_URI}`)
};

export default connectDB;