export const handler = async (event: any) => {
    console.log(JSON.stringify(event));

    let body = JSON.parse(event.body);

    // verify request

    // respond with challenge
    let response = {
        statusCode: 200,
        body: JSON.stringify({"challenge":body.challenge})
    };

    return response;
};