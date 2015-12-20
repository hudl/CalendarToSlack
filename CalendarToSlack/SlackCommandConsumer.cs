using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Amazon;
using Amazon.SQS;
using Amazon.SQS.Model;
using log4net;

namespace CalendarToSlack
{
    class SlackCommandConsumer
    {
        private static readonly ILog Log = LogManager.GetLogger(typeof (SlackCommandConsumer).Name);

        private readonly AmazonSQSClient _client;
        private readonly string _slackCommandVerificationToken;
        private readonly string _queueUrl;
        private readonly Updater _updater;

        public SlackCommandConsumer(string slackCommandVerificationToken, string awsAccessKey, string awsSecretKey, string queueUrl, Updater updater)
        {
            if (string.IsNullOrWhiteSpace(slackCommandVerificationToken))
            {
                throw new ArgumentException();
            }

            if (string.IsNullOrWhiteSpace(awsAccessKey))
            {
                throw new ArgumentException();
            }

            if (string.IsNullOrWhiteSpace(awsSecretKey))
            {
                throw new ArgumentException();
            }

            if (string.IsNullOrWhiteSpace(queueUrl))
            {
                throw new ArgumentException();
            }

            if (updater == null)
            {
                throw new ArgumentNullException("updater");
            }

            _client = new AmazonSQSClient(awsAccessKey, awsSecretKey, new AmazonSQSConfig
            {
                Timeout = TimeSpan.FromSeconds(2),
                ReadWriteTimeout = TimeSpan.FromSeconds(2),
                RegionEndpoint = RegionEndpoint.USEast1,
            });
            _slackCommandVerificationToken = slackCommandVerificationToken;
            _queueUrl = queueUrl;
            _updater = updater;
        }

        public void Start()
        {
            Task.Run(() => Consume());
        }

        public void Consume()
        {
            Log.DebugFormat("Starting SQS consumer thread");
            while (true)
            {
                List<Message> messages = null;
                try
                {
                    var req = new ReceiveMessageRequest
                    {
                        QueueUrl = _queueUrl,
                        MaxNumberOfMessages = 10, // SQS max = 10
                    };

                    var res = _client.ReceiveMessage(req);
                    messages = res.Messages;

                    foreach (var message in res.Messages)
                    {
                        try
                        {
                            var split = message.Body.Split('&');
                            var fields = split.ToDictionary(entry => entry.Split('=')[0], entry => entry.Split('=')[1]);

                            var token = fields["token"];
                            if (token != _slackCommandVerificationToken)
                            {
                                Log.DebugFormat(message.Body);
                                Log.ErrorFormat("Token mismatch (received {0})", token);
                                continue; // On to the next message, maybe it's okay.
                            }

                            var userId = fields["user_id"];
                            _updater.MarkBack(userId);
                        }
                        catch (Exception e)
                        {
                            Log.DebugFormat(message.Body);
                            Log.Error("Error handling slack command", e);
                        }
                    }
                }
                catch (Exception e)
                {
                    Log.Error("Error consuming slack command messages", e);
                }
                finally
                {
                    if (messages != null && messages.Count > 0)
                    {
                        try
                        {
                            var req = new DeleteMessageBatchRequest
                            {
                                QueueUrl = _queueUrl,
                                Entries = messages.Select(message => new DeleteMessageBatchRequestEntry
                                {
                                    Id = message.MessageId,
                                    ReceiptHandle = message.ReceiptHandle,
                                }).ToList(),
                            };

                            var res = _client.DeleteMessageBatch(req);
                            if (res.Failed != null && res.Failed.Any())
                            {
                                Log.ErrorFormat("Error deleting {0} messages", res.Failed.Count);
                            }
                        }
                        catch (Exception e)
                        {
                            Log.Error("Error deleting messages", e);
                        }
                    }
                }

                Thread.Sleep(TimeSpan.FromSeconds(5));
            }
        }
    }
}
