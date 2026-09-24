from fastapi import FastAPI

app = FastAPI()


@app.get("/")
def root():
    return {"message": "Hello World"}


@app.get("/hello")
def hello():
    return {"message": "Hello from FastAPI"}