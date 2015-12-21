using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
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
        private readonly UserDatabase _userdb;

        public SlackCommandConsumer(string slackCommandVerificationToken, string awsAccessKey, string awsSecretKey, string queueUrl, Updater updater, UserDatabase userdb)
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

            if (userdb == null)
            {
                throw new ArgumentNullException("userdb");
            }

            _client = new AmazonSQSClient(awsAccessKey, awsSecretKey, new AmazonSQSConfig
            {
                // 20s timeout is greater than our WaitTimeSeconds for long-polling
                Timeout = TimeSpan.FromSeconds(20),
                ReadWriteTimeout = TimeSpan.FromSeconds(20),
                RegionEndpoint = RegionEndpoint.USEast1,
            });
            _slackCommandVerificationToken = slackCommandVerificationToken;
            _queueUrl = queueUrl;
            _updater = updater;
            _userdb = userdb;
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
                //Log.DebugFormat("Polling SQS");
                List<Message> messages = null;
                try
                {
                    var req = new ReceiveMessageRequest
                    {
                        QueueUrl = _queueUrl,
                        MaxNumberOfMessages = 10, // SQS max = 10
                        WaitTimeSeconds = 10,
                    };

                    var res = _client.ReceiveMessage(req);
                    messages = res.Messages;

                    if (messages.Count > 0)
                    {
                        Log.DebugFormat("Received {0} SQS message(s)", res.Messages.Count);
                    }
                    
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

                            HandleMessage(fields);
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
                    Thread.Sleep(TimeSpan.FromSeconds(5)); // Back off a bit.
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
            }
        }

        private void HandleMessage(Dictionary<string, string> fields)
        {
            var command = fields["slashcommand"];
            var userId = fields["user_id"];
            if (command == "back")
            {
                _updater.MarkBack(userId);

                return;
            }

            if (command == "whitelist")
            {
                var text = WebUtility.UrlDecode(fields["text"]);
                var options = text.Split();
                if (options.Length == 0 || (options.Length == 1 && (string.IsNullOrWhiteSpace(options[0]) || string.Equals(options[0], "show", StringComparison.OrdinalIgnoreCase))))
                {
                    _userdb.EchoWhitelistToSlackbot(userId);
                    // TODO show();
                    return;
                }

                if (options.Length >= 2)
                {
                    if (string.Equals(options[0], "add", StringComparison.OrdinalIgnoreCase))
                    {
                        var combined = new HashSet<string>();
                        for (var i = 1; i < options.Length; i++)
                        {
                            combined.Add(options[i]);
                        }
                        _userdb.AddToWhitelist(userId, string.Join("|", combined));
                        return;
                    }

                    if (string.Equals(options[0], "remove", StringComparison.OrdinalIgnoreCase))
                    {
                        var combined = new HashSet<string>();
                        for (var i = 1; i < options.Length; i++)
                        {
                            combined.Add(options[i]);
                        }
                        _userdb.RemoveFromWhitelist(userId, string.Join("|", combined));
                        return;
                    }
                }
                
                // TODO see how easy it'll be to have whitelist changes affect current events
                // TODO how to do a null/empty response to the command

                return;
            }

            Log.ErrorFormat("Unrecognized slash command {0} from user {1}", command, userId);
        }


    }
}
