import json
import csv
import argparse
import os
import os.path
import re
import shutil

'''
    participant's ID and pass ID enable to locate the data
    source_dir : './static/results/'
    image_dir contains all original images: './static/originals/'
    result_dir is the location of the input data for style mixing: '../style_mixing_app/static/experiment_1/'
'''
def optim_to_stylem(user_id,pass_id,source_dir,image_dir,result_dir):

    # creation of data folder
    if not os.path.exists(result_dir+'{}'.format(user_id)):
        os.makedirs(result_dir+'{}'.format(user_id))

    # creation of pass folder
    if os.path.exists(result_dir+'{}/{}/'.format(user_id,pass_id)):
        return("Already formatted data for this user and pass")
    else:
        os.makedirs(result_dir+'{}/{}/'.format(user_id,pass_id))

    # load data from path.csv
    data = []
    output_dict = {}
    with open(source_dir+str(user_id)+'/'+str(pass_id)+'/path.csv', 'r') as csvfile:
        csvreader = csv.reader(csvfile,delimiter=',')
        for row in csvreader:
            if row[2] not in data:
                data.append(row[2])
    
    # create output dict 
    path = result_dir+'{}/{}/'.format(user_id,pass_id)
    for idx,image in enumerate(data):
        output_dict[idx] = '/static/experiment_1/{}/{}/'.format(user_id,pass_id) +image

    # store image paths in selections.csv
    with open(result_dir+'{}/{}/selections.json'.format(user_id,pass_id),'w') as jsonfile:
        json.dump(output_dict, jsonfile, indent=4)
    
    # copy image files in folder and best solution image
    for image in data:
        shutil.copy2(image_dir+image,path)
        shutil.copy2(image_dir+data[len(data) - 1],path+'best_choice.png')
            


    return("Successfully formatted data")

'''
    extracts seed number from image_path
    result_dir is the location of the input data for manipulation of semantics:
     '../manipulation_of_semantics/static/experiment_1/'
'''
def optim_to_mos(user_id,pass_id,image_path,result_dir):
    
    # extraction of seed number
    pattern_seed = "seed(\d{4,}).png"
    seed = re.search(pattern_seed,image_path).group(1)
    
    # creation of data folder
    if not os.path.exists(result_dir+'{}'.format(user_id)):
        os.makedirs(result_dir+'{}'.format(user_id))

    # creation of pass folder
    if os.path.exists(result_dir+'{}/{}/'.format(user_id,pass_id)):
        return("Already formatted data for this user and pass")
    else:
        os.makedirs(result_dir+'{}/{}/'.format(user_id,pass_id))

    # store final selection seed number in selection.csv
    with open(result_dir+'{}/{}/selection.json'.format(user_id,pass_id),'w') as jsonfile:
        json.dump({'seed' : seed}, jsonfile, indent=4)

    return("Successfully formatted data")



