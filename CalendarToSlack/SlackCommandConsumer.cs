using Amazon;
using Amazon.SQS;
using Amazon.SQS.Model;
using log4net;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

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
            
            // TODO case sensitivity
            // TODO manage default status

            if (command == "whitelist")
            {
                var text = WebUtility.UrlDecode(fields["text"]);
                var options = Regex.Matches(text.Trim(), @"[\""].+?[\""]|[^ ]+")
                    .Cast<Match>()
                    .Select(m => m.Value.Replace("\"", ""))
                    .ToList();
                
                // /c2s-whitelist
                if (options.Count == 0)
                {
                    _userdb.EchoWhitelistToSlackbot(userId);
                    return;
                }

                var subcommand = options[0];
                var args = (options.Count > 1 ? options.Skip(1).ToList() : new List<string>());
                
                Log.DebugFormat($"subcommand = {subcommand}, args = {string.Join("|", args)}");

                // /c2s-whitelist help
                if (subcommand.Equals("help", StringComparison.OrdinalIgnoreCase))
                {
                    _userdb.EchoWhitelistSyntaxToSlackbot(userId);
                    return;
                }

                // /c2s-whitelist set "Working From Home"
                // /c2s-whitelist set "Working From Home" :home:
                // /c2s-whitelist set "Working From Home" "WFH"
                // /c2s-whitelist set "Working From Home" "WFH" :home:
                // /c2s-whitelist set Plan
                // /c2s-whitelist set Plan :calendar:
                // /c2s-whitelist set Plan Meeting
                // /c2s-whitelist set Plan Meeting :calendar:
                if (subcommand.Equals("set", StringComparison.OrdinalIgnoreCase))
                {
                    if (args.Count == 0 || args.Any(ContainsIllegalCharacters)) return;

                    _userdb.AddToWhitelist(userId, TokenizeArgs(args[0], args.Skip(1).ToList()));
                    return;
                }

                // /c2s-whitelist remove "Working From Home"
                // /c2s-whitelist remove NSS
                if (subcommand.Equals("remove", StringComparison.OrdinalIgnoreCase))
                {
                    if (args.Count == 0 || args.Any(ContainsIllegalCharacters)) return;

                    _userdb.RemoveFromWhitelist(userId, args[0]);
                    return;
                }

                // /c2s-whitelist set-default Marvel
                // /c2s-whitelist set-default Marvel :marvel:
                // /c2s-whitelist set-default :marvel:
                // /c2s-whitelist set-default "Project Marvel" :marvel:
                if (subcommand.Equals("set-default", StringComparison.OrdinalIgnoreCase))
                {
                    if (args.Count == 0 || args.Any(ContainsIllegalCharacters)) return;

                    _userdb.AddToWhitelist(userId, TokenizeArgs(StatusConstants.DefaultStatus, args));
                    return;
                }

                // /c2s-whitelist remove-default
                if (subcommand.Equals("remove-default", StringComparison.OrdinalIgnoreCase))
                {
                    _userdb.RemoveFromWhitelist(userId, StatusConstants.DefaultStatus);
                    return;
                }
            }

            Log.ErrorFormat("Unrecognized slash command {0} from user {1}", command, userId);
        }

        private static string TokenizeArgs(string token, List<string> args)
        {
            if (!args.Any()) return token;

            if (args.Count == 1)
            {
                if (IsEmoji(args[0]))
                {
                    token += $";{args[0]}";
                }
                else
                {
                    token += $">{args[0]}";
                }
            }
            else if (args.Count > 1)
            {
                token += $">{args[0]};{args[1]}";
            }

            return token;
        }

        private static bool IsEmoji(string arg)
        {
            if (string.IsNullOrWhiteSpace(arg)) return false;
            
            return arg.StartsWith(":") && arg.EndsWith(":");
        }

        private static bool ContainsIllegalCharacters(string arg)
        {
            if (string.IsNullOrWhiteSpace(arg)) return false;

            return arg.Contains(";") 
                || arg.Contains(">") 
                || arg.Contains("|") 
                || arg.Contains("[") 
                || arg.Contains("]");
        }
    }
}
